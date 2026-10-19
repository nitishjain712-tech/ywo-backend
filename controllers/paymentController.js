const logger = require("../utils/logger");
// src/controllers/paymentController.js
const pool = require("../config/db");
const Payment = require("../models/paymentModel");
const Order = require("../models/orderModel");
const OrderItem = require("../models/orderItemModel");
const phonepeService = require("../services/phonepeService");
const { getGateway } = require("../services/paymentGatewayFactory");
const { recordCouponUsageForOrder } = require("../utils/orderHelpers");

const crypto = require("crypto");


const paymentController = {
  /**
   * Initiate PhonePe payment for an existing order (order must be PENDING)
   * Body: { order_id }
   */
  initiatePayment: async (req, res) => {
    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      const user_id = req.user?.id;
      if (!user_id) return res.status(401).json({ message: "Unauthorized" });

      const { order_id } = req.body;
      if (!order_id) return res.status(400).json({ message: "order_id required" });

      const order = await Order.getOrderById(order_id);
      if (!order) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ message: "Order not found" });
      }
      if (order.user_id !== user_id && !req.user.isAdmin) {
        await conn.rollback();
        conn.release();
        return res.status(403).json({ message: "Forbidden" });
      }
      if (order.order_status !== "PENDING") {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ message: "Order not in PENDING state" });
      }

      const payment = await Payment.getPaymentByOrder(order_id);
      if (!payment) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ message: "Payment record not found for order" });
      }

      // Initiate PhonePe
      const phonepeResp = await phonepeService.initiatePayment(order_id, order.total_amount);
      // Save transaction/merchant ids
      await Payment.saveTransactionIdByPaymentId(payment.payment_id, phonepeResp.merchant_order_id, phonepeResp.transaction_id);

      await conn.commit();
      conn.release();

      return res.json({
        paymentUrl: phonepeResp.redirectUrl,
        transactionId: phonepeResp.transaction_id,
        merchantOrderId: phonepeResp.merchant_order_id,
      });
    } catch (err) {
      await conn.rollback();
      conn.release();
      logger.error("initiatePayment error:", err);
      return res.status(500).json({ message: "Could not initiate payment", error: err.message });
    }
  },


  adminListPayments: async (req, res) => {
  try {
    const { page, limit, status, payment_method, search } = req.query;

    const result = await Payment.getAllPayments({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      status: status || null,
      payment_method: payment_method || null,
      search: search || "",
    });

    return res.json({
      message: "Payments fetched successfully",
      ...result,
    });
  } catch (err) {
    logger.error("❌ Admin list payments failed:", err);
    return res.status(500).json({ message: "Error fetching payments" });
  }
},


  /**
   * PhonePe callback handler (webhook)
   * You already have this logic. Keep as-is or use the implementation below.
   */
  callback: async (req, res) => {
    try {
      const username = process.env.PHONEPE_CLIENT_ID;
      const password = process.env.PHONEPE_CLIENT_SECRET;
      const authorizationHeader = req.headers['x-callback-signature'];
      const bodyString = JSON.stringify(req.body);

      const verified = phonepeService.verifyCallbackSignature(
        username,
        password,
        authorizationHeader,
        bodyString
      );

      if (!verified) return res.status(400).json({ message: "Invalid callback signature" });

      const { code, merchantOrderId, data } = req.body;
      const payment = await Payment.getPaymentByTransactionId(merchantOrderId);

      if (!payment) return res.status(404).json({ message: "Payment not found" });

      const status = code === "PAYMENT_SUCCESS" ? "SUCCESS" : "FAILED";

      await Payment.setPaymentResult({
        transaction_id: merchantOrderId, // or data.transactionId depending on PhonePe
        order_id: payment.order_id,
        status,
        payment_reference: data.paymentId || null,
        payment_response: data,
      });

      await Order.updateOrderStatus(payment.order_id, status === "SUCCESS" ? "CONFIRMED" : "CANCELLED");

      if (status === "SUCCESS") {
        try {
          await recordCouponUsageForOrder(payment.order_id);
        } catch (couponErr) {
          logger.error("⚠️ PhonePe coupon recording error for order", payment.order_id, couponErr);
        }
      }

      if (status === "FAILED") await OrderItem.releaseItemsStock(payment.order_id);

      return res.status(200).json({ message: `Payment ${status.toLowerCase()}` });
    } catch (err) {
      logger.error("payment callback error:", err);
      return res.status(500).json({ message: "Error processing callback", error: err.message });
    }
  },

  webhook: async (req, res) => {
  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const signature = req.headers["x-razorpay-signature"];
    const body = req.body;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== signature) {
      await conn.rollback();
      return res.status(400).json({ message: "Invalid webhook signature" });
    }

    const event = JSON.parse(body.toString());


    // ✅ ADD THIS BLOCK HERE
    if (!["payment.captured", "payment.failed"].includes(event.event)) {
      await conn.commit();
      return res.json({ message: "Event ignored" });
    }

    const paymentData = event.payload?.payment?.entity;

    if (!paymentData) {
      await conn.rollback();
      return res.status(400).json({ message: "Invalid webhook payload" });
    }

    const razorpayOrderId = paymentData.order_id;
    const razorpayPaymentId = paymentData.id;
    const status = paymentData.status; // captured / failed

    const payment = await Payment.getPaymentByMerchantOrderId(razorpayOrderId);

    if (!payment) {
      await conn.rollback();
      return res.status(404).json({ message: "Payment not found" });
    }

    // 🔐 IDENTITY CHECK — prevent duplicate processing
    if (payment.status === "SUCCESS" || payment.status === "REFUNDED") {
      await conn.commit();
      return res.json({ message: "Already processed" });
    }

    if (status === "captured") {

      // Update payment
      await Payment.setPaymentResult({
        transaction_id: razorpayPaymentId,
        order_id: payment.order_id,
        status: "SUCCESS",
        payment_reference: razorpayPaymentId,
        payment_response: event,
      }, conn);

      // Lock stock
      const items = await OrderItem.getItemsByOrder(payment.order_id);

      for (const item of items) {
        const [rows] = await conn.query(
          `SELECT stock FROM product_variants WHERE id = ? FOR UPDATE`,
          [item.variant_id]
        );

        if (!rows.length || rows[0].stock < item.quantity)
          throw new Error("Insufficient stock");

        await conn.query(
          `UPDATE product_variants 
           SET stock = stock - ? 
           WHERE id = ?`,
          [item.quantity, item.variant_id]
        );
      }

      await conn.query(
        `UPDATE orders 
         SET order_status = 'CONFIRMED', updated_at = NOW() 
         WHERE order_id = ?`,
        [payment.order_id]
      );

      await conn.query(
        `UPDATE order_items 
         SET item_status = 'CONFIRMED' 
         WHERE order_id = ?`,
        [payment.order_id]
      );
    }

    if (status === "failed") {

      await conn.query(
        `UPDATE payments 
         SET status = 'FAILED', updated_at = NOW() 
         WHERE order_id = ?`,
        [payment.order_id]
      );

      await conn.query(
        `UPDATE orders 
         SET order_status = 'CANCELLED', updated_at = NOW() 
         WHERE order_id = ?`,
        [payment.order_id]
      );
    }

    await conn.commit();

    if (status === "captured") {
      try {
        await recordCouponUsageForOrder(payment.order_id);
      } catch (couponErr) {
        logger.error("⚠️ Webhook coupon recording error for order", payment.order_id, couponErr);
      }
    }

    return res.json({ message: "Webhook processed" });

  } catch (err) {
    await conn.rollback();
    logger.error("Webhook error:", err);
    return res.status(500).json({ message: "Webhook failed" });
  } finally {
    conn.release();
  }
},


  verifyPayment: async (req, res) => {
  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const gatewayName = process.env.ACTIVE_PAYMENT_GATEWAY;
    const gateway = getGateway();

    let merchantOrderId, transactionId, isValid;

    if (gatewayName === "Razorpay") {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      } = req.body;

      merchantOrderId = razorpay_order_id;
      transactionId = razorpay_payment_id;

      isValid = gateway.verifySignature(
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      );
    } else {
      // PhonePe callback handling
      return res.status(400).json({ message: "Use PhonePe callback endpoint" });
    }

    if (!isValid) {
      await conn.rollback();
      return res.status(400).json({ message: "Invalid signature" });
    }

    const payment = await Payment.getPaymentByMerchantOrderId(merchantOrderId);

    if (!payment) {
      await conn.rollback();
      return res.status(404).json({ message: "Payment not found" });
    }

    // ADD THIS
if (payment.status === "SUCCESS" || payment.status === "REFUNDED") {
  await conn.commit();
  return res.json({ message: "Already processed" });
}

    // Update payment
    await Payment.setPaymentResult({
      transaction_id: transactionId,
      order_id: payment.order_id,
      status: "SUCCESS",
      payment_reference: transactionId,
      payment_response: req.body,
    }, conn);

    // Lock stock
    const items = await OrderItem.getItemsByOrder(payment.order_id);

    for (const item of items) {
      const [rows] = await conn.query(
        `SELECT stock FROM product_variants WHERE id = ? FOR UPDATE`,
        [item.variant_id]
      );

      if (!rows.length || rows[0].stock < item.quantity)
        throw new Error("Insufficient stock");

      await conn.query(
        `UPDATE product_variants SET stock = stock - ? WHERE id = ?`,
        [item.quantity, item.variant_id]
      );
    }

    await conn.query(
      `UPDATE orders SET order_status = 'CONFIRMED' WHERE order_id = ?`,
      [payment.order_id]
    );

    await conn.query(
      `UPDATE order_items SET item_status = 'CONFIRMED' WHERE order_id = ?`,
      [payment.order_id]
    );

    await conn.commit();

    try {
      await recordCouponUsageForOrder(payment.order_id);
    } catch (couponErr) {
      logger.error("⚠️ Verify coupon recording error for order", payment.order_id, couponErr);
    }

    return res.json({ message: "Payment verified & order confirmed" });

  } catch (err) {
    await conn.rollback();
    logger.error("Verify error:", err);
    return res.status(500).json({ message: "Verification failed" });
  } finally {
    conn.release();
  }
},

  // keep other helper methods (checkStatus, checkAndUpdateStatus, getStatus, adminRefund) unchanged
  checkStatus: async (req, res) => {
    try {
      const { merchantOrderId } = req.params;
      const result = await phonepeService.checkOrderStatus(merchantOrderId);
      return res.json(result);
    } catch (err) {
      logger.error("checkStatus error:", err);
      return res.status(500).json({ message: "Error fetching payment status", error: err.message });
    }
  },

  checkAndUpdateStatus: async (req, res) => {
    try {
      const { merchantOrderId } = req.params;
      if (!merchantOrderId) return res.status(400).json({ message: "merchantOrderId required" });

      const statusResponse = await phonepeService.checkOrderStatus(merchantOrderId, true); // true = include attempts
      const paymentDetails = statusResponse.paymentDetails || [];
      const lastAttempt = paymentDetails[paymentDetails.length - 1];
      const state = lastAttempt?.state || statusResponse.state;

      const payment = await Payment.getPaymentByMerchantOrderId(merchantOrderId);
      if (!payment) return res.status(404).json({ message: "Payment not found" });

      const dbStatus = state === "COMPLETED" ? "SUCCESS" : state === "FAILED" ? "FAILED" : "PENDING";

      await Payment.setPaymentResult({
        transaction_id: lastAttempt?.transactionId || statusResponse.orderId,
        order_id: payment.order_id,
        status: dbStatus,
        payment_reference: lastAttempt?.transactionId || null,
        payment_response: statusResponse,
      });

      if (dbStatus === "SUCCESS") {
        await Order.updateOrderStatus(payment.order_id, "CONFIRMED");
      } else if (dbStatus === "FAILED") {
        await Order.updateOrderStatus(payment.order_id, "CANCELLED");
        await OrderItem.releaseItemsStock(payment.order_id);
      }

      return res.json({ status: dbStatus, payment });
    } catch (err) {
      logger.error("checkAndUpdateStatus error:", err);
      return res.status(500).json({ message: "Error checking/updating status", error: err.message });
    }
  },

  getStatus: async (req, res) => {
    try {
      const user_id = req.user?.id;
      const order_id = req.params.orderId;
      if (!user_id) return res.status(401).json({ message: "Unauthorized" });

      const order = await Order.getOrderById(order_id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.user_id !== user_id && !req.user.isAdmin) return res.status(403).json({ message: "Forbidden" });

      const payment = await Payment.getPaymentByOrder(order_id);
      return res.json({ order, payment });
    } catch (err) {
      logger.error("getStatus error:", err);
      return res.status(500).json({ message: "Error fetching status", error: err.message });
    }
  },

  adminRefund: async (req, res) => {
    try {
      if (!req.user?.isAdmin) return res.status(403).json({ message: "Forbidden" });

      const order_id = req.params.orderId;
      const { amount } = req.body;

      const payment = await Payment.getPaymentByOrder(order_id);
      if (!payment) return res.status(404).json({ message: "Payment not found" });
      if (payment.status !== "SUCCESS") return res.status(400).json({ message: "Only successful payments can be refunded" });

      const amountPaise = Math.round((amount || Number(payment.amount)) * 100);
      // await phonepeService.refundPayment(payment.transaction_id, amountPaise);
            // const gateway = getGateway();

      // await gateway.refundPayment(payment.transaction_id, amount);



      await Payment.updatePaymentByOrderId(order_id, {
        status: "REFUNDED",
        payment_response: { refunded: true },
      });
      await Order.updateOrderStatus(order_id, "CANCELLED");

      return res.json({ message: "Refund processed" });
    } catch (err) {
      logger.error("adminRefund error:", err);
      return res.status(500).json({ message: "Error processing refund", error: err.message });
    }
  },

  getAllPayments: async (req, res) => {
  try {
    // ✅ Use req.admin instead of req.user
    // if (!req.admin)
    //   return res.status(403).json({ message: "Forbidden: Admin access only" });

    const payments = await Payment.getAllPayments(req.query);
    return res.json({ message: "Payments fetched successfully", ...payments });
  } catch (err) {
    logger.error("❌ getAllPayments error:", err);
    return res.status(500).json({ message: "Error fetching payments", error: err.message });
  }
},


updateCODPaymentStatus : async (req, res) => {
  try {
    const { payment_id, status } = req.body;

    if (!payment_id || !status) {
      return res.status(400).json({ message: "payment_id and status are required" });
    }

    // ✅ Check if payment exists and is COD
    const payment = await Payment.getPaymentById(payment_id);
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }
    if (payment.payment_method !== "COD") {
      return res
        .status(400)
        .json({ message: "Only COD payment status can be updated" });
    }

    // ✅ Update payment status
    const success = await Payment.updateCODStatus(payment_id, status);

    if (!success) {
      return res.status(400).json({ message: "Failed to update payment status" });
    }

    return res.json({
      message: `✅ COD payment status updated to '${status}' successfully`,
    });
  } catch (err) {
    logger.error("❌ Error updating COD payment:", err);
    return res.status(500).json({ message: "Server error" });
  }
},


};

module.exports = paymentController;
