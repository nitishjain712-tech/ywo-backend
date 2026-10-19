const logger = require("../utils/logger");
// controllers/paymentCron.js
const cron = require("node-cron");
const pLimit = require("p-limit").default;
const pool = require("../config/db");
const Payment = require("../models/paymentModel");
const Order = require("../models/orderModel");
const OrderItem = require("../models/orderItemModel");
const phonepeService = require("../services/phonepeService");
const orderEmailService = require("../services/orderEmailService");
const adminOrderEmailService = require("../services/adminOrderEmailService");
// -------------------- Config --------------------
const CONCURRENCY = 5;             // concurrent PhonePe requests
const PENDING_COOLDOWN_MS = 1000 * 60 * 5; // 5 minutes cooldown for "still pending" orders
const limit = pLimit(CONCURRENCY);

// in-memory cooldown map: merchant_order_id -> timestamp last-checked (ms)
const pendingCooldown = new Map();

/**
 * Normalize the status response from the phonepeService to one of: SUCCESS, FAILED, PENDING, UNKNOWN
 * Accepts different shapes returned by different implementations.
 */
function normalizeStatus(resp) {
  if (!resp) return { dbStatus: "UNKNOWN", state: "UNKNOWN", paymentDetails: [] };

  // If service returns already-normalized object with dbStatus
  if (resp.dbStatus) {
    return {
      dbStatus: resp.dbStatus,
      state: resp.state || resp.dbStatus,
      paymentDetails: resp.paymentDetails || resp.payment_details || resp.raw?.paymentDetails || [],
      raw: resp.raw || resp,
    };
  }

  // If service returned SDK/raw response that may contain state/paymentDetails
  const state = resp.state || resp.data?.state || resp.data?.orderStatus || "UNKNOWN";
  const paymentDetails = resp.paymentDetails || resp.data?.paymentDetails || resp.payment_details || [];

  const dbStatus =
    state === "COMPLETED" ? "SUCCESS" :
      state === "FAILED" ? "FAILED" :
        state === "PENDING" ? "PENDING" :
          "UNKNOWN";

  return { dbStatus, state, paymentDetails, raw: resp };
}

// -------------------- CRON --------------------
cron.schedule("*/3 * * * *", async () => {
  logger.info("[Payment Cron] 🔄 Starting payment status check...");

  try {
    const pendingPayments = await Payment.getPendingPayments();

    if (!pendingPayments?.length) {
      logger.info("[Payment Cron] ✅ No pending payments to process.");
      return;
    }

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let pendingCount = 0;

    // Run with concurrency limiting
    const tasks = pendingPayments.map(payment =>
      limit(async () => {
        const { merchant_order_id: merchantOrderId } = payment;

        // cooldown: skip if we checked recently and it's still pending
        const lastCheck = pendingCooldown.get(merchantOrderId);
        if (lastCheck && Date.now() - lastCheck < PENDING_COOLDOWN_MS) {
          skippedCount++;
          logger.info(`[Payment Cron] ⏭ Skipping ${payment.payment_id} (${merchantOrderId}) — cooldown`);
          return;
        }

        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();

          // Use robust retry wrapper from service
          let statusResp;
          try {
            statusResp = await phonepeService.checkOrderStatusWithRetry(merchantOrderId, true, 2);
          } catch (err) {
            // If PhonePe check fails entirely, don't change DB state; rollback and move on
            await conn.rollback();
            logger.error(`[Payment Cron] ⚠️ API check failed for ${merchantOrderId}:`, err.message || err);
            return;
          }

          const { dbStatus, state, paymentDetails, raw } = normalizeStatus(statusResp);
          const lastAttempt = (paymentDetails && paymentDetails.length) ? paymentDetails[paymentDetails.length - 1] : null;

          // Update payment record (use provided conn)
          await Payment.setPaymentResult({
            transaction_id: lastAttempt?.transactionId || raw?.orderId || raw?.order_id || null,
            order_id: payment.order_id,
            status: dbStatus,
            payment_reference: lastAttempt?.transactionId || lastAttempt?.paymentId || null,
            payment_response: raw || statusResp
          }, conn);

          logger.info(`[Payment Cron] 💳 Payment ${payment.payment_id} for Order ${payment.order_id} → ${dbStatus}`);

          // Fetch order and items
          const [orderRows] = await conn.query(`SELECT * FROM orders WHERE order_id = ? LIMIT 1`, [payment.order_id]);
          const orderData = orderRows?.[0];
          if (!orderData) {
            await conn.rollback();
            throw new Error(`Order not found for ID ${payment.order_id}`);
          }

          const items = await OrderItem.getItemsByOrder(payment.order_id);

          // Handle SUCCESS
          if (dbStatus === "SUCCESS") {
            // Remove from pending cooldown (no need to check again)
            pendingCooldown.delete(merchantOrderId);

            // Lock + check stock
            for (const item of items) {
              const [rows] = await conn.query(
                `SELECT stock FROM product_variants WHERE id = ? FOR UPDATE`,
                [item.variant_id]
              );
              if (!rows.length) throw new Error(`Variant not found: ${item.variant_id}`);
              if (rows[0].stock < item.quantity)
                throw new Error(`Insufficient stock for variant ${item.variant_id}`);
            }

            // Deduct stock & record coupon usage
            for (const item of items) {
              await conn.query(
                `UPDATE product_variants SET stock = stock - ? WHERE id = ?`,
                [item.quantity, item.variant_id]
              );

              if (item.coupon_id) {
                await conn.query(
                  `INSERT INTO coupon_usages (coupon_id, user_id, order_id, order_item_id, status, used_at)
                   VALUES (?, ?, ?, ?, 'USED', NOW())
                   ON DUPLICATE KEY UPDATE status='USED', reverted_at=NULL, used_at=NOW()`,
                  [item.coupon_id, orderData.user_id, orderData.order_id, item.order_item_id]
                );

                await conn.query(
                  `UPDATE coupons SET usage_limit = usage_limit - 1 WHERE id = ? AND usage_limit > 0`,
                  [item.coupon_id]
                );
              }
            }

            // Order-level coupon
            if (orderData.order_coupon_id) {
              await conn.query(
                `INSERT INTO coupon_usages (coupon_id, user_id, order_id, status, used_at)
                 VALUES (?, ?, ?, 'USED', NOW())
                 ON DUPLICATE KEY UPDATE status='USED', reverted_at=NULL, used_at=NOW()`,
                [orderData.order_coupon_id, orderData.user_id, orderData.order_id]
              );
              await conn.query(
                `UPDATE coupons SET usage_limit = usage_limit - 1 WHERE id = ? AND usage_limit > 0`,
                [orderData.order_coupon_id]
              );
            }

            // Update order status to CONFIRMED
            await conn.query(
              `UPDATE orders SET order_status = 'CONFIRMED', updated_at = NOW() WHERE order_id = ?`,
              [orderData.order_id]
            );

            try {
              await conn.query(
                `UPDATE order_items SET item_status = 'CONFIRMED' WHERE order_id = ?`,
                [orderData.order_id]
              );
            } catch (e) {
              logger.error("❌ Failed to update order_items:", e.message);
            }


            await conn.commit();
            successCount++;
            logger.info(`[Payment Cron] 🟢 Order ${orderData.order_id} confirmed successfully.`);

            /* -------------------------------------------------
               📧 ONLINE SUCCESS EMAILS (POST-COMMIT)
            -------------------------------------------------- */
            try {
              const [rows] = await pool.query(
                `SELECT o.*, u.email, u.name
                 FROM orders o
                 JOIN users u ON u.id = o.user_id
                   WHERE o.order_id = ?`,
                [orderData.order_id]
              );

              const orderForMail = rows[0];

              if (!orderForMail) {
                logger.warn("⚠️ Order not found for email:", orderData.order_id);
              } else {

                const [orderItemsForEmail] = await pool.query(
                  `SELECT 
         oi.quantity,
         oi.price,
         oi.subtotal AS sub_total,
         p.name AS product_name,
         pv.variant_name
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       JOIN product_variants pv ON oi.variant_id = pv.id
       WHERE oi.order_id = ?`,
                  [orderData.order_id]
                );

                /* -------------------------------
                   CUSTOMER EMAIL
                -------------------------------- */
                if (!orderForMail.order_notification_sent) {
                  await orderEmailService.sendOrderEmail({
                    eventType: "ORDER_PLACED",
                    order: {
                      ...orderForMail,
                      payment_method: "ONLINE",
                      order_status: "CONFIRMED"
                    },
                    items: orderItemsForEmail,
                    user: {
                      name: orderForMail.name,
                      email: orderForMail.email
                    }
                  });

                  await pool.query(
                    `UPDATE orders
         SET order_notification_sent = 1
         WHERE order_id = ?`,
                    [orderForMail.order_id]
                  );

                  logger.info("📧 ONLINE SUCCESS CUSTOMER EMAIL SENT:", orderForMail.order_id);
                }

                /* -------------------------------
                   ADMIN EMAIL
                -------------------------------- */
                if (!orderForMail.admin_notification_sent) {
                  await adminOrderEmailService.sendAdminNewOrderEmail({
                    order: {
                      order_id: orderForMail.order_id,
                      total_amount: orderForMail.total_amount,
                      payment_method: "ONLINE"
                    },
                    items: orderItemsForEmail,
                    user: {
                      name: orderForMail.name,
                      email: orderForMail.email
                    }
                  });

                  await pool.query(
                    `UPDATE orders
         SET admin_notification_sent = 1
         WHERE order_id = ?`,
                    [orderForMail.order_id]
                  );

                  logger.info("📧 ONLINE SUCCESS ADMIN EMAIL SENT:", orderForMail.order_id);
                }
              }
            } catch (emailErr) {
              logger.error("❌ ONLINE SUCCESS EMAIL ERROR:", emailErr.message);
            }

            // Handle FAILED
          } else if (dbStatus === "FAILED") {
            // Remove from cooldown as final state reached
            pendingCooldown.delete(merchantOrderId);

            // Restore stock
            for (const item of items) {
              await conn.query(
                `UPDATE product_variants SET stock = stock + ? WHERE id = ?`,
                [item.quantity, item.variant_id]
              );
            }

            // Revert coupon usage
            const [usages] = await conn.query(
              `SELECT * FROM coupon_usages WHERE order_id = ? AND status = 'USED'`,
              [orderData.order_id]
            );

            for (const usage of usages) {
              await conn.query(
                `UPDATE coupon_usages SET status='REVERTED', reverted_at=NOW() WHERE usage_id = ?`,
                [usage.usage_id]
              );

              await conn.query(
                `UPDATE coupons SET usage_limit = usage_limit + 1 WHERE id = ?`,
                [usage.coupon_id]
              );
            }

            // Cancel order
            await conn.query(
              `UPDATE orders SET order_status = 'CANCELLED', updated_at = NOW() WHERE order_id = ?`,
              [orderData.order_id]
            );

            try {
              await conn.query(
                `UPDATE order_items SET item_status = 'CANCELLED' WHERE order_id = ?`,
                [orderData.order_id]
              );
            } catch (e) {
              logger.error("❌ Failed to update order_items:", e.message);
            }

            await conn.commit();
            failedCount++;
            logger.info(`[Payment Cron] 🔴 Order ${orderData.order_id} cancelled and stock/coupons reverted.`);
            // -------------------------------------------------
            // 📧 ONLINE PAYMENT FAILED EMAIL (POST-COMMIT)
            // -------------------------------------------------
            try {
              const [orderRows] = await pool.query(
                `SELECT o.*, u.email, u.name
     FROM orders o
     JOIN users u ON u.id = o.user_id
     WHERE o.order_id = ?`,
                [orderData.order_id]
              );

              const orderForMail = orderRows[0];

              if (!orderForMail.order_notification_sent) {

                const [orderItemsForEmail] = await pool.query(
                  `SELECT 
         oi.quantity,
         oi.price,
         oi.subtotal AS sub_total,
         p.name AS product_name,
         pv.variant_name
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       JOIN product_variants pv ON oi.variant_id = pv.id
       WHERE oi.order_id = ?`,
                  [orderData.order_id]
                );

                await orderEmailService.sendOrderEmail({
                  eventType: "PAYMENT_FAILED",
                  order: {
                    ...orderForMail,
                    payment_method: "ONLINE",
                    order_status: "CANCELLED"
                  },
                  items: orderItemsForEmail,
                  user: {
                    name: orderForMail.name,
                    email: orderForMail.email
                  }
                });

                await pool.query(
                  `UPDATE orders
       SET order_notification_sent = 1
       WHERE order_id = ?`,
                  [orderData.order_id]
                );

                logger.info("📧 ONLINE FAILURE EMAIL SENT:", orderData.order_id);
              }
            } catch (emailErr) {
              logger.error("❌ ONLINE FAILURE EMAIL FAILED:", emailErr.message);
            }

            // STILL PENDING
          } else if (dbStatus === "PENDING") {
            // commit nothing changed to payment but we updated payment_response above — commit that
            await conn.commit();

            // set cooldown so we don't hammer PhonePe for same pending order
            pendingCooldown.set(merchantOrderId, Date.now());
            pendingCount++;
            logger.info(`[Payment Cron] ⏳ Order ${payment.order_id} still pending. Cooldown applied.`);
          } else {
            // UNKNOWN or unhandled -> commit the updated payment_response and move on
            await conn.commit();
            logger.info(`[Payment Cron] ❔ Order ${payment.order_id} returned status ${dbStatus}. No action.`);
          }
        } catch (err) {
          // Ensure we rollback and log
          try { await conn.rollback(); } catch (e) { /* ignore */ }
          logger.error(`[Payment Cron] ⚠️ Error processing Order ${payment.order_id} (${merchantOrderId}):`, err.message || err);
        } finally {
          try { conn.release(); } catch (e) { /* ignore */ }
        }
      })
    );

    // Wait for all tasks to settle
    await Promise.allSettled(tasks);

    logger.info(`[Payment Cron] ✅ Completed. success=${successCount} failed=${failedCount} pending=${pendingCount} skipped=${skippedCount}`);
  } catch (err) {
    logger.error("[Payment Cron] 🧨 FATAL ERROR:", err.message || err);
  }
});



// const cron = require("node-cron");
// const pool = require("../config/db");
// const Payment = require("../models/paymentModel");
// const Order = require("../models/orderModel");
// const OrderItem = require("../models/orderItemModel");
// const phonepeService = require("../services/phonepeService");

// cron.schedule("*/2 * * * *", async () => {
//   logger.info("[Payment Cron] 🔄 Starting payment status check...");

//   try {
//     const pendingPayments = await Payment.getPendingPayments();
//     if (!pendingPayments?.length) {
//       logger.info("[Payment Cron] ✅ No pending payments to process.");
//       return;
//     }

//     await Promise.allSettled(
//       pendingPayments.map(async (payment) => {
//         const conn = await pool.getConnection();
//         await conn.beginTransaction();

//         try {
//           // 1️⃣ Get payment status from PhonePe
//           const statusResp = await phonepeService.checkOrderStatus(payment.merchant_order_id, true);
//           const paymentDetails = statusResp.paymentDetails || [];
//           const lastAttempt = paymentDetails[paymentDetails.length - 1];
//           const state = lastAttempt?.state || statusResp.state;

//           const dbStatus =
//             state === "COMPLETED" ? "SUCCESS" :
//             state === "FAILED" ? "FAILED" :
//             "PENDING";

//           // 2️⃣ Update payment status in DB
//           await Payment.setPaymentResult({
//             transaction_id: lastAttempt?.transactionId || statusResp.orderId,
//             order_id: payment.order_id,
//             status: dbStatus,
//             payment_reference: lastAttempt?.transactionId || null,
//             payment_response: statusResp
//           }, conn);

//           logger.info(`[Payment Cron] 💳 Payment ${payment.payment_id} for Order ${payment.order_id} → ${dbStatus}`);

//           // 3️⃣ Fetch order and its items
//           const [order] = await conn.query(`SELECT * FROM orders WHERE order_id = ? LIMIT 1`, [payment.order_id]);
//           const orderData = order[0];
//           if (!orderData) throw new Error(`Order not found for ID ${payment.order_id}`);

//           const items = await OrderItem.getItemsByOrder(payment.order_id);

//           // 4️⃣ SUCCESS → confirm order, deduct stock, record coupon usage
//           if (dbStatus === "SUCCESS") {
//             logger.info(`[Payment Cron] ✅ Payment success for Order ${payment.order_id}. Confirming order...`);

//             // Lock stock rows
//             for (const item of items) {
//               const [rows] = await conn.query(
//                 `SELECT stock FROM product_variants WHERE id = ? FOR UPDATE`,
//                 [item.variant_id]
//               );
//               if (!rows.length) throw new Error(`Variant not found: ${item.variant_id}`);
//               if (rows[0].stock < item.quantity)
//                 throw new Error(`Insufficient stock for variant ${item.variant_id}`);
//             }

//             // Deduct stock
//             for (const item of items) {
//               await conn.query(
//                 `UPDATE product_variants SET stock = stock - ? WHERE id = ?`,
//                 [item.quantity, item.variant_id]
//               );

//               // Record item-level coupon usage
//               if (item.coupon_id) {
//                 await conn.query(
//                   `INSERT INTO coupon_usages (coupon_id, user_id, order_id, order_item_id, status, used_at)
//                    VALUES (?, ?, ?, ?, 'USED', NOW())
//                    ON DUPLICATE KEY UPDATE status='USED', reverted_at=NULL, used_at=NOW()`,
//                   [item.coupon_id, orderData.user_id, orderData.order_id, item.order_item_id]
//                 );

//                 await conn.query(
//                   `UPDATE coupons SET usage_limit = usage_limit - 1 WHERE id = ? AND usage_limit > 0`,
//                   [item.coupon_id]
//                 );
//               }
//             }

//             // Order-level coupon usage
//             if (orderData.order_coupon_id) {
//               await conn.query(
//                 `INSERT INTO coupon_usages (coupon_id, user_id, order_id, status, used_at)
//                  VALUES (?, ?, ?, 'USED', NOW())
//                  ON DUPLICATE KEY UPDATE status='USED', reverted_at=NULL, used_at=NOW()`,
//                 [orderData.order_coupon_id, orderData.user_id, orderData.order_id]
//               );

//               await conn.query(
//                 `UPDATE coupons SET usage_limit = usage_limit - 1 WHERE id = ? AND usage_limit > 0`,
//                 [orderData.order_coupon_id]
//               );
//             }

//             // Update order status → CONFIRMED
//             await conn.query(
//               `UPDATE orders SET order_status = 'CONFIRMED', updated_at = NOW() WHERE order_id = ?`,
//               [orderData.order_id]
//             );

//             await conn.commit();
//             logger.info(`[Payment Cron] 🟢 Order ${orderData.order_id} confirmed successfully.`);

//           // 5️⃣ FAILED → cancel order, restore stock, revert coupon usage
//           } else if (dbStatus === "FAILED") {
//             logger.info(`[Payment Cron] ❌ Payment failed for Order ${payment.order_id}. Cancelling order...`);

//             // Restore stock
//             for (const item of items) {
//               await conn.query(
//                 `UPDATE product_variants SET stock = stock + ? WHERE id = ?`,
//                 [item.quantity, item.variant_id]
//               );
//             }

//             // Revert coupon usage
//             const [usages] = await conn.query(
//               `SELECT * FROM coupon_usages WHERE order_id = ? AND status = 'USED'`,
//               [orderData.order_id]
//             );

//             for (const usage of usages) {
//               await conn.query(
//                 `UPDATE coupon_usages SET status='REVERTED', reverted_at=NOW() WHERE usage_id = ?`,
//                 [usage.usage_id]
//               );

//               await conn.query(
//                 `UPDATE coupons SET usage_limit = usage_limit + 1 WHERE id = ?`,
//                 [usage.coupon_id]
//               );
//             }

//             // Mark order as CANCELLED
//             await conn.query(
//               `UPDATE orders SET order_status = 'CANCELLED', updated_at = NOW() WHERE order_id = ?`,
//               [orderData.order_id]
//             );

//             await conn.commit();
//             logger.info(`[Payment Cron] 🔴 Order ${orderData.order_id} cancelled and stock/coupons reverted.`);

//           // 6️⃣ PENDING → do nothing
//           } else {
//             await conn.rollback();
//             logger.info(`[Payment Cron] ⏳ Order ${payment.order_id} still pending. Skipping...`);
//           }

//         } catch (err) {
//           await conn.rollback();
//           logger.error(`[Payment Cron] ⚠️ Error processing Order ${payment.order_id}:`, err.message);
//         } finally {
//           conn.release();
//         }
//       })
//     );

//     logger.info("[Payment Cron] ✅ Payment status check completed.");
//   } catch (err) {
//     logger.error("[Payment Cron] 🧨 FATAL ERROR:", err.message);
//   }
// });
