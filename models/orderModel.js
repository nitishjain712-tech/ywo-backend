const logger = require("../utils/logger");
// src/models/orderModel.js
const pool = require("../config/db");
const { releaseStockForOrder, revertCouponsForOrder, revertCouponsForCancelledItems } = require("../utils/orderHelpers");


const orderModel = {
  createOrderRecord: async ({
    conn,
    user_id,
    address_id,
    shipping,
    total_amount,
    discount_amount = 0,
    coupon_id = null,
    total_shipping_price = 0,
    shipping_message = null
  }) => {
    try {
      const sql = `
        INSERT INTO orders
        (user_id, address_id, shipping_name, shipping_phone, shipping_street, shipping_city, shipping_state, shipping_zip, shipping_country, total_amount, total_discount_amount, coupon_id, total_shipping_price, shipping_message, order_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
      `;

      const params = [
        user_id,
        address_id,
        shipping.name,
        shipping.phone,
        shipping.street,
        shipping.city,
        shipping.state,
        shipping.zip,
        shipping.country,
        total_amount,
        discount_amount,
        coupon_id,
        total_shipping_price,
        shipping_message
      ];

      const [result] = conn
        ? await conn.query(sql, params)
        : await pool.query(sql, params);

      return { order_id: result.insertId };
    } catch (err) {
      logger.error("Create Order Error:", err);
      throw new Error("Error creating order");
    }
  },

  getOrderById: async (order_id) => {
    try {
      const [orderRows] = await pool.query(
        `SELECT * FROM orders WHERE order_id = ?`,
        [order_id]
      );
      if (!orderRows.length) return null;

      const order = orderRows[0];

      const [itemRows] = await pool.query(
        `SELECT 
      oi.*,
      pv.variant_name,
      pv.sku,
      pv.price AS variant_price,
      pv.mrp AS variant_mrp,
      pv.stock AS variant_stock,
      p.name AS product_name,
      p.brand AS product_brand,
      p.category_id,
      p.avg_rating,
      pm.media_url AS product_thumbnail
   FROM order_items oi
   JOIN product_variants pv ON oi.variant_id = pv.id
   JOIN products p ON oi.product_id = p.id
   LEFT JOIN (
     SELECT product_id, ANY_VALUE(media_url) AS media_url
     FROM product_media
     WHERE media_type = 'image'
     GROUP BY product_id
   ) pm ON p.id = pm.product_id
   WHERE oi.order_id = ?`,
        [order_id]
      );
      // Fetch payment details
      const [paymentRows] = await pool.query(
        `SELECT payment_method, status, amount,payment_reference 
       FROM payments WHERE order_id = ?`,
        [order_id]
      );

      order.items = itemRows;
      order.payment = paymentRows.length ? paymentRows[0] : null;
      return order;
    } catch (err) {
      logger.error("🔥 Full SQL error:", err);
      throw err; // don't wrap it, let the top-level see the real message
    }
  },


  // ✅ Admin: Get all orders with pagination, search, and optional status filter
  getAllOrders: async ({ page = 1, limit = 20, status = null, search = "" }) => {
    try {
      const offset = (page - 1) * limit;
      const params = [];
      let whereClauses = [];

      // 🔍 Filter by status
      if (status) {
        whereClauses.push("o.order_status = ?");
        params.push(status);
      }

      // 🔎 Search (by order_id, name, phone, coupon, or transaction id)
      if (search) {
        whereClauses.push(
          `(o.order_id LIKE ? OR o.shipping_name LIKE ? OR o.shipping_phone LIKE ? OR o.order_coupon_code LIKE ? OR p.transaction_id LIKE ?)`
        );
        const s = `%${search}%`;
        params.push(s, s, s, s, s);
      }

      const whereSQL = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

      // 1️⃣ Fetch orders (include all relevant columns)
      const [orders] = await pool.query(
        `
      SELECT 
        o.order_id,
        o.user_id,
        o.address_id,
        o.shipping_name,
        o.shipping_phone,
        o.shipping_street,
        o.shipping_city,
        o.shipping_state,
        o.shipping_zip,
        o.shipping_country,
        o.gst_number,
        o.total_amount,
        o.total_discount_amount,
        o.total_shipping_price,
        o.order_status,
        o.order_coupon_id,
        o.order_coupon_code,
        o.created_at,
        o.updated_at,
        o.courier_name,
        o.courier_tracking_id,
        o.date_of_shipment,
        o.cod_charge,
        o.cod_charge_type,
        o.cod_charge_rate,
        o.additional_charge,
        o.additional_charge_type,
        o.additional_charge_rate,
        p.status AS payment_status,
        p.payment_method,
        p.payment_gateway
      FROM orders o
      LEFT JOIN payments p ON o.order_id = p.order_id
      ${whereSQL}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
      `,
        [...params, parseInt(limit, 10), parseInt(offset, 10)]
      );

      if (!orders.length) {
        return { orders: [], total: 0, page, limit };
      }

      // 2️⃣ Count total for pagination
      const [countRows] = await pool.query(
        `
      SELECT COUNT(*) AS total
      FROM orders o
      LEFT JOIN payments p ON o.order_id = p.order_id
      ${whereSQL}
      `,
        params
      );

      const total = countRows[0]?.total || 0;

      // 3️⃣ Fetch order items for all orders
      const orderIds = orders.map((o) => o.order_id);
      const [items] = await pool.query(
        `
      SELECT 
        oi.order_item_id,
        oi.order_id,
        oi.product_id,
        p.name AS product_name,
        v.variant_name,
        v.sku,
        oi.quantity,
        oi.price,
        oi.subtotal
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN product_variants v ON v.id = oi.variant_id
      WHERE oi.order_id IN (?)
      ORDER BY oi.order_id
      `,
        [orderIds]
      );

      // 4️⃣ Group items under orders
      const orderMap = {};
      orders.forEach((o) => {
        orderMap[o.order_id] = { ...o, items: [] };
      });

      items.forEach((item) => {
        if (orderMap[item.order_id]) {
          orderMap[item.order_id].items.push({
            order_item_id: item.order_item_id,
            product_id: item.product_id,
            product_name: item.product_name,
            variant_name: item.variant_name,
            sku: item.sku,
            quantity: item.quantity,
            price: item.price,
            subtotal: item.subtotal,
          });
        }
      });

      // 5️⃣ Final paginated response
      return {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        orders: Object.values(orderMap),
      };
    } catch (err) {
      logger.error("❌ Get All Orders (Admin) Error:", err);
      throw new Error("Error fetching admin orders");
    }
  },


  async getUserOrders(user_id, status = null) {
    let query = `
      SELECT 
        o.order_id,
        o.total_amount,
        o.total_discount_amount,
        o.total_shipping_price,
        o.order_status,
        o.created_at,
        o.updated_at,
        o.shipping_name,
        o.shipping_phone,
        o.shipping_street,
        o.shipping_city,
        o.shipping_state,
        o.shipping_zip,
        o.shipping_country,
        p.status AS payment_status,
        p.payment_method,
        p.payment_gateway,
        p.transaction_id,
        p.merchant_order_id
      FROM orders o
      LEFT JOIN payments p ON o.order_id = p.order_id
      WHERE o.user_id = ?
    `;
    const params = [user_id];
    if (status) {
      query += ` AND o.order_status = ?`;
      params.push(status);
    }
    query += ` ORDER BY o.created_at DESC`;
    const [orders] = await pool.query(query, params);
    return orders;
  },

  // ✅ Fetch items for multiple orders
  async getOrderItems(orderIds) {
    if (!orderIds.length) return [];
    const [items] = await pool.query(
      `
      SELECT 
        oi.order_id,
        oi.order_item_id,
        oi.product_id,
        oi.variant_id,
        p.name AS product_name,
        v.variant_name,
        oi.quantity,
        oi.price,
        oi.subtotal,
        oi.per_item_discount,
        oi.coupon_code,
        oi.shipping_price,
        oi.shipping_message
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN product_variants v ON v.id = oi.variant_id
      WHERE oi.order_id IN (?)
      ORDER BY oi.order_id
      `,
      [orderIds]
    );
    return items;
  },

  updateOrderStatus: async (order_id, status) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1️⃣ Update order main status
      await conn.query(
        `UPDATE orders 
       SET order_status = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE order_id = ?`,
        [status, order_id]
      );

      // 2️⃣ Update all items status for this order
      await conn.query(
        `UPDATE order_items 
       SET item_status = ? 
       WHERE order_id = ?`,
        [status, order_id]
      );

      await conn.commit();
      conn.release();
      return true;
    } catch (err) {
      await conn.rollback();
      conn.release();
      logger.error("Update Order Status Error:", err);
      throw new Error("Error updating order and item status");
    }
  },

  returnOrder: async (order_id, order_item_ids = []) => {
    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      // 1️⃣ Fetch order
      const [[order]] = await conn.query(
        `SELECT order_id, order_coupon_code
         FROM orders
         WHERE order_id = ?
         LIMIT 1`,
        [order_id]
      );
      if (!order) throw new Error("Order not found");

      const isOrderLevelCoupon = !!order.order_coupon_code;

      // 2️⃣ Fetch items (LOCK rows)
      const [dbItems] = await conn.query(
        `SELECT 
           order_item_id, 
           item_status, 
           variant_id, 
           quantity,
           coupon_id
         FROM order_items
         WHERE order_id = ?
         FOR UPDATE`,
        [order_id]
      );

      if (!dbItems.length) throw new Error("No items found for this order");

      const itemMap = new Map();
      dbItems.forEach(i => itemMap.set(i.order_item_id, i));

      // 3️⃣ Determine full or partial return
      const isFullReturn = !Array.isArray(order_item_ids) || order_item_ids.length === 0;

      const workList = isFullReturn
        ? dbItems.map(i => i.order_item_id)
        : order_item_ids.map(id => Number(id));

      // Validate items
      for (const id of workList) {
        if (!itemMap.has(id)) {
          throw new Error(`Item ${id} does not belong to this order`);
        }
      }

      // ❗ Block: Prevent returning cancelled items
      for (const id of workList) {
        const item = itemMap.get(id);

        if (item.item_status === "CANCELLED") {
          throw new Error(`Item ${id} is cancelled and cannot be returned`);
        }
      }

      // ❗ Block: Prevent returning refunded items
      for (const id of workList) {
        const item = itemMap.get(id);

        if (item.item_status === "REFUNDED") {
          throw new Error(`Item ${id} is already refunded and cannot be returned`);
        }
      }

      // 4️⃣ Return logic + stock restore + coupon collect
      const stockMap = new Map();
      const itemCouponIdsToRevert = new Set();

      for (const id of workList) {
        const item = itemMap.get(id);

        const wasReturned = item.item_status === "RETURNED";

        // Mark item returned
        await conn.query(
          `UPDATE order_items
           SET item_status = 'RETURNED'
           WHERE order_item_id = ?`,
          [id]
        );

        // Stock restore only once
        if (!wasReturned && item.variant_id && item.quantity > 0) {
          stockMap.set(
            item.variant_id,
            (stockMap.get(item.variant_id) || 0) + Number(item.quantity)
          );
        }

        // Collect item-level coupons
        if (item.coupon_id) {
          itemCouponIdsToRevert.add(item.coupon_id);
        }
      }

      // 5️⃣ Stock restore
      for (const [variantId, qty] of stockMap.entries()) {
        await conn.query(
          `UPDATE product_variants
           SET stock = stock + ?
           WHERE id = ?`,
          [qty, variantId]
        );
      }

      // 6️⃣ Check if full return now
      const [[statusCheck]] = await conn.query(
        `SELECT 
            COUNT(*) AS total,
            SUM(item_status IN ('RETURNED','CANCELLED')) AS closed
         FROM order_items
         WHERE order_id = ?`,
        [order_id]
      );

      const allReturned = Number(statusCheck.total) === Number(statusCheck.closed);

      // 7️⃣ Coupon revert logic
      if (isOrderLevelCoupon && allReturned) {
        await conn.query(
          `UPDATE coupon_usages
           SET status = 'REVERTED', reverted_at = NOW()
           WHERE order_id = ? AND status = 'USED'`,
          [order_id]
        );

        await conn.query(
          `UPDATE coupons
           SET usage_limit = usage_limit + 1
           WHERE code = ?`,
          [order.order_coupon_code]
        );
      }

      // Item-level coupon revert
      for (const couponId of itemCouponIdsToRevert) {
        await conn.query(
          `UPDATE coupon_usages
           SET status = 'REVERTED', reverted_at = NOW()
           WHERE order_id = ? AND coupon_id = ? AND status = 'USED'`,
          [order_id, couponId]
        );

        await conn.query(
          `UPDATE coupons
           SET usage_limit = usage_limit + 1
           WHERE id = ?`,
          [couponId]
        );
      }

      // 8️⃣ Update order status
      await conn.query(
        `UPDATE orders
         SET order_status = ?, updated_at = NOW()
         WHERE order_id = ?`,
        [allReturned ? "RETURNED" : "PARTIALLY_RETURNED", order_id]
      );

      await conn.commit();
      conn.release();

      return {
        success: true,
        message: allReturned
          ? "Full order returned successfully"
          : "Partial order return processed",
        fully_returned: allReturned,
        item_level_coupons_reverted: [...itemCouponIdsToRevert],
        order_level_coupon_reverted: isOrderLevelCoupon && allReturned
      };

    } catch (err) {
      await conn.rollback();
      conn.release();
      throw err;
    }
  },

  reserveStock: async (connOrPool, variant_id, quantity) => {
    try {
      const conn = connOrPool || pool;
      const [rows] = await conn.query(
        `SELECT stock FROM product_variants WHERE id = ? FOR UPDATE`,
        [variant_id]
      );

      if (!rows.length) throw new Error(`Variant not found: ${variant_id}`);

      const currentStock = rows[0].stock;
      if (currentStock < quantity) {
        throw new Error(`Insufficient stock for variant ${variant_id}. Requested ${quantity}, available ${currentStock}`);
      }

      await conn.query(
        `UPDATE product_variants SET stock = stock - ? WHERE id = ?`,
        [quantity, variant_id]
      );
      return true;
    } catch (err) {
      logger.error("Reserve Stock Error:", err);
      throw new Error("Error reserving stock");
    }
  },

  releaseStock: async (variant_id, quantity) => {
    try {
      await pool.query(
        `UPDATE product_variants SET stock = stock + ? WHERE id = ?`,
        [quantity, variant_id]
      );
      return true;
    } catch (err) {
      logger.error("Release Stock Error:", err);
      throw new Error("Error releasing stock");
    }
  },

  // ✅ Cancel selected items or full order
  //   cancelOrder: async (order_id, order_item_ids = []) => {
  //   const conn = await pool.getConnection();
  //   try {
  //     await conn.beginTransaction();

  //     // 1️⃣ Fetch order
  //     const [orderRows] = await conn.query(
  //       "SELECT order_id, order_status FROM orders WHERE order_id = ?",
  //       [order_id]
  //     );
  //     if (!orderRows.length) throw new Error("Order not found");

  //     const order = orderRows[0];

  //     // 🚫 Block cancel after shipped or delivered
  //     if (["SHIPPED", "DELIVERED"].includes(order.order_status)) {
  //       throw new Error("Cannot cancel order after it has been shipped or delivered");
  //     }

  //     // 2️⃣ Fetch payment info
  //     const [paymentRows] = await conn.query(
  //       "SELECT payment_id, payment_method, status FROM payments WHERE order_id = ?",
  //       [order_id]
  //     );
  //     const payment = paymentRows[0];

  //     // 3️⃣ CASE: Per-item cancel
  //     if (order_item_ids.length > 0) {
  //       await conn.query(
  //         `UPDATE order_items 
  //          SET item_status = 'CANCELLED', admin_note = 'Cancelled by admin'
  //          WHERE order_id = ? AND order_item_id IN (?)`,
  //         [order_id, order_item_ids]
  //       );

  //       // Count remaining items
  //       const [[counts]] = await conn.query(
  //         `SELECT 
  //            SUM(item_status = 'CANCELLED') AS cancelled,
  //            COUNT(*) AS total
  //          FROM order_items WHERE order_id = ?`,
  //         [order_id]
  //       );

  //       const allCancelled = counts.cancelled === counts.total;

  //       await conn.query(
  //         `UPDATE orders 
  //          SET order_status = ?
  //          WHERE order_id = ?`,
  //         [allCancelled ? "CANCELLED" : "PARTIALLY_CANCELLED", order_id]
  //       );

  //       // For prepaid only → mark refund pending
  //       if (payment && payment.payment_method !== "COD" && payment.status === "SUCCESS") {
  //         await conn.query(
  //           `UPDATE payments SET status = 'REFUND_PENDING' WHERE payment_id = ?`,
  //           [payment.id]
  //         );
  //       }

  //       await conn.commit();
  //       return {
  //         message: allCancelled
  //           ? "Full order cancelled successfully"
  //           : "Selected items cancelled successfully",
  //       };
  //     }

  //     // 4️⃣ CASE: Full order cancel
  //     await conn.query(
  //       `UPDATE order_items 
  //        SET item_status = 'CANCELLED', admin_note = 'Full order cancelled by admin'
  //        WHERE order_id = ?`,
  //       [order_id]
  //     );

  //     await conn.query(
  //       `UPDATE orders SET order_status = 'CANCELLED' WHERE order_id = ?`,
  //       [order_id]
  //     );

  //     if (payment && payment.payment_method !== "COD" && payment.status === "SUCCESS") {
  //       await conn.query(
  //         `UPDATE payments SET status = 'REFUND_PENDING' WHERE payment_id = ?`,
  //         [payment.id]
  //       );
  //     }

  //     await conn.commit();
  //     return { message: "Full order cancelled successfully" };
  //   } catch (err) {
  //     await conn.rollback();
  //     logger.error("❌ cancelOrder failed:", err);
  //     throw err;
  //   } finally {
  //     conn.release();
  //   }
  // },

  cancelOrder: async (order_id, order_item_ids = []) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // ----------------------------------------------------
      // 1️⃣ FETCH ORDER + BASIC VALIDATIONS
      // ----------------------------------------------------
      const [orderRows] = await conn.query(
        `SELECT order_id, order_status FROM orders WHERE order_id = ?`,
        [order_id]
      );
      if (!orderRows.length) throw new Error("Order not found");

      const order = orderRows[0];

      if (order.order_status === "CANCELLED")
        throw new Error("Order is already cancelled");

      if (["SHIPPED", "DELIVERED"].includes(order.order_status))
        throw new Error("Cannot cancel order after it has been shipped/delivered");

      if (order.order_status === "RETURN_REQUESTED")
        throw new Error("Cannot cancel order. Return request already raised.");

      // ----------------------------------------------------
      // 2️⃣ PAYMENT CHECK (must exist & must not be fully refunded)
      // ----------------------------------------------------
      const [paymentRows] = await conn.query(
        `SELECT payment_id, payment_method, status 
       FROM payments WHERE order_id = ?`,
        [order_id]
      );

      if (!paymentRows.length)
        throw new Error("Payment record missing for this order");

      const payment = paymentRows[0];

      if (payment.status === "REFUNDED")
        throw new Error("Order already fully refunded. Cannot cancel now.");

      // ----------------------------------------------------
      // 3️⃣ FULL ORDER CANCELLATION
      // ----------------------------------------------------
      if (order_item_ids.length === 0) {
        // Cancel all items
        await conn.query(
          `UPDATE order_items 
         SET item_status = 'CANCELLED', admin_note = 'Full order cancelled'
         WHERE order_id = ?`,
          [order_id]
        );

        // Restore stock
        const [items] = await conn.query(
          `SELECT order_item_id, variant_id, quantity 
         FROM order_items WHERE order_id = ?`,
          [order_id]
        );

        for (const it of items) {
          await conn.query(
            `UPDATE product_variants SET stock = stock + ? WHERE id = ?`,
            [it.quantity, it.variant_id]
          );
        }

        // Revert coupon usage for all items
        const cancelledIds = items.map(it => it.order_item_id);
        await revertCouponsForCancelledItems(conn, order_id, cancelledIds);

        // Update order status
        await conn.query(
          `UPDATE orders SET order_status = 'CANCELLED' WHERE order_id = ?`,
          [order_id]
        );

        await conn.commit();
        return { message: "Full order cancelled successfully" };
      }

      // ----------------------------------------------------
      // 4️⃣ PARTIAL CANCELLATION
      // ----------------------------------------------------

      // A. Check items belong to this order
      const [validItems] = await conn.query(
        `SELECT order_item_id, variant_id, quantity
       FROM order_items 
       WHERE order_id = ? AND order_item_id IN (?)`,
        [order_id, order_item_ids]
      );

      if (validItems.length !== order_item_ids.length)
        throw new Error("Some order_item_ids do not belong to this order");

      // B. Ensure only CONFIRMED items can be cancelled
      const [blockedItems] = await conn.query(
        `SELECT order_item_id, item_status 
   FROM order_items 
   WHERE order_id = ?
     AND order_item_id IN (?)
     AND item_status != 'CONFIRMED'`,
        [order_id, order_item_ids]
      );

      if (blockedItems.length > 0) {
        const invalidStatuses = blockedItems
          .map(b => `${b.order_item_id}(${b.item_status})`)
          .join(", ");

        throw new Error(
          `These items cannot be cancelled because they are not CONFIRMED: ${invalidStatuses}`
        );
      }


      // ----------------------------------------------------
      // 5️⃣ CANCEL SELECTED ITEMS
      // ----------------------------------------------------
      await conn.query(
        `UPDATE order_items 
       SET item_status = 'CANCELLED', admin_note = 'Item cancelled'
       WHERE order_id = ? AND order_item_id IN (?)`,
        [order_id, order_item_ids]
      );

      // Restore stock
      for (const it of validItems) {
        await conn.query(
          `UPDATE product_variants SET stock = stock + ? WHERE id = ?`,
          [it.quantity, it.variant_id]
        );
      }

      // ----------------------------------------------------
      // 6️⃣ ORDER STATUS UPDATE (PARTIAL / FULL)
      // ----------------------------------------------------
      const [[counts]] = await conn.query(
        `SELECT 
         SUM(item_status = 'CANCELLED') AS cancelled,
         COUNT(*) AS total
       FROM order_items WHERE order_id = ?`,
        [order_id]
      );

      const allCancelled = Number(counts.cancelled) === Number(counts.total);

      await conn.query(
        `UPDATE orders SET order_status = ? WHERE order_id = ?`,
        [allCancelled ? "CANCELLED" : "PARTIALLY_CANCELLED", order_id]
      );

      // ----------------------------------------------------
      // 7️⃣ REVERT COUPON USAGE FOR CANCELLED ITEMS ONLY
      // ----------------------------------------------------
      await revertCouponsForCancelledItems(conn, order_id, order_item_ids);

      await conn.commit();

      return {
        message: allCancelled
          ? "Full order cancelled successfully"
          : "Selected items cancelled successfully",
      };

    } catch (err) {
      await conn.rollback();
      logger.error("❌ cancelOrder failed:", err);
      throw err;
    } finally {
      conn.release();
    }
  },




  markReturnRequest: async (order_id, items = []) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      if (items.length > 0) {
        // Partial return
        for (const itemId of items) {
          await conn.query(
            `UPDATE order_items 
           SET item_status = 'RETURN_REQUESTED' 
           WHERE order_item_id = ? AND order_id = ?`,
            [itemId, order_id]
          );
        }
        await conn.query(
          `UPDATE orders 
         SET order_status = 'RETURN_REQUESTED' 
         WHERE order_id = ?`,
          [order_id]
        );
      } else {
        // Full order return
        await conn.query(
          `UPDATE order_items 
         SET item_status = 'RETURN_REQUESTED' 
         WHERE order_id = ?`,
          [order_id]
        );
        await conn.query(
          `UPDATE orders 
         SET order_status = 'RETURN_REQUESTED' 
         WHERE order_id = ?`,
          [order_id]
        );
      }

      await conn.commit();
      return { success: true, message: "Return request marked successfully" };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  confirmReturn: async (order_id, items = [], refundData = []) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      let totalRefund = 0;

      if (items.length > 0) {
        // Partial return confirmed
        for (const item of refundData) {
          await conn.query(
            `UPDATE order_items 
           SET item_status = 'RETURNED', refunded_amount = ?
           WHERE id = ? AND order_id = ?`,
            [item.refunded_amount, item.order_item_id, order_id]
          );
          totalRefund += parseFloat(item.refunded_amount);
        }
        await conn.query(
          `UPDATE orders 
         SET order_status = 'PARTIALLY_RETURNED'
         WHERE id = ?`,
          [order_id]
        );
      } else {
        // Full order return confirmed
        await conn.query(
          `UPDATE order_items 
         SET item_status = 'RETURNED', refunded_amount = subtotal
         WHERE order_id = ?`,
          [order_id]
        );
        const [[{ total }]] = await conn.query(
          `SELECT SUM(subtotal) AS total FROM order_items WHERE order_id = ?`,
          [order_id]
        );
        totalRefund = total;
        await conn.query(
          `UPDATE orders 
         SET order_status = 'RETURNED'
         WHERE id = ?`,
          [order_id]
        );
      }

      // Update payments table (manual refund tracking)
      await conn.query(
        `UPDATE payments 
       SET refunded_total = refunded_total + ?, 
           status = IF(refunded_total + ? < amount, 'PARTIALLY_REFUNDED', 'REFUNDED')
       WHERE order_id = ?`,
        [totalRefund, totalRefund, order_id]
      );

      await conn.commit();
      return { success: true, message: "Return confirmed successfully" };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  // recordRefund: async (order_id, refunds = []) => {
  //   const conn = await pool.getConnection();
  //   try {
  //     await conn.beginTransaction();

  //     // 1️⃣ Fetch payment
  //     const [paymentRows] = await conn.query(
  //       "SELECT payment_id, payment_method, refunded_total, amount FROM payments WHERE order_id = ?",
  //       [order_id]
  //     );
  //     const payment = paymentRows[0];
  //     if (!payment) throw new Error("Payment not found");

  //     if (payment.payment_method === "COD") {
  //       throw new Error("Refund not required for COD orders");
  //     }

  //     if (!refunds.length) {
  //       throw new Error("Refund details required");
  //     }

  //     // 2️⃣ Fetch order
  //     const [[orderRow]] = await conn.query(
  //       "SELECT total_amount FROM orders WHERE order_id = ?",
  //       [order_id]
  //     );
  //     if (!orderRow) throw new Error("Order not found");

  //     let currentTotal = Number(orderRow.total_amount);
  //     let totalRefundedAmount = 0;
  //     let subtractOriginalSubtotal = 0;

  //     // 3️⃣ Process each refund
  //     for (const r of refunds) {

  //       // Fetch item
  //       const [[item]] = await conn.query(
  //         `SELECT subtotal, item_status 
  //          FROM order_items 
  //          WHERE order_id = ? AND order_item_id = ?`,
  //         [order_id, r.order_item_id]
  //       );

  //       if (!item) {
  //         throw new Error(`Item ${r.order_item_id} not found for this order`);
  //       }

  //       // ❌ VALIDATION: Only CANCELLED items can be refunded
  //       if (item.item_status !== "CANCELLED") {
  //         throw new Error(
  //           `Item ${r.order_item_id} cannot be refunded because it is not CANCELLED (current status: ${item.item_status})`
  //         );
  //       }

  //       const originalSubtotal = Number(item.subtotal);

  //       // Update as refunded
  //       await conn.query(
  //         `UPDATE order_items
  //          SET refunded_amount = ?, item_status = 'REFUNDED'
  //          WHERE order_item_id = ? AND order_id = ?`,
  //         [r.refunded_amount, r.order_item_id, order_id]
  //       );

  //       totalRefundedAmount += Number(r.refunded_amount);
  //       subtractOriginalSubtotal += originalSubtotal;
  //     }

  //     // 4️⃣ Update order total
  //     const newOrderTotal = currentTotal - subtractOriginalSubtotal;
  //     await conn.query(
  //       `UPDATE orders SET total_amount = ? WHERE order_id = ?`,
  //       [newOrderTotal, order_id]
  //     );

  //     // 5️⃣ Update payment
  //     const newRefundedTotal = Number(payment.refunded_total || 0) + totalRefundedAmount;
  //     const fullyRefunded = newRefundedTotal >= Number(payment.amount);

  //     await conn.query(
  //       `UPDATE payments 
  //        SET refunded_total = ?, status = ?
  //        WHERE payment_id = ?`,
  //       [
  //         newRefundedTotal,
  //         fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
  //         payment.payment_id,
  //       ]
  //     );

  //     // 6️⃣ Update order status
  //     await conn.query(
  //       `UPDATE orders 
  //        SET order_status = ?
  //        WHERE order_id = ?`,
  //       [fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED", order_id]
  //     );

  //     // 7️⃣ Revert coupons if fully refunded
  //     if (fullyRefunded) {
  //       await revertCouponsForOrder(conn, order_id);
  //     }

  //     await conn.commit();

  //     return {
  //       success: true,
  //       message: fullyRefunded ? "Full refund processed" : "Partial refund processed",
  //       refunded_amount: totalRefundedAmount,
  //       subtracted_original_price: subtractOriginalSubtotal,
  //       new_order_total: newOrderTotal
  //     };

  //   } catch (err) {
  //     await conn.rollback();
  //     throw err;
  //   } finally {
  //     conn.release();
  //   }
  // },

  // recordRefundCancel: async (order_id, refunds = []) => {
  //   const conn = await pool.getConnection();
  //   try {
  //     await conn.beginTransaction();

  //     // --- Validate basic input
  //     if (!order_id) throw new Error("order_id is required");
  //     if (!Array.isArray(refunds) || refunds.length === 0) {
  //       throw new Error("refunds array is required and cannot be empty");
  //     }

  //     // Normalize + merge duplicate refund items
  //     const normalized = [];
  //     const seen = new Set();
  //     for (const r of refunds) {
  //       if (!r || typeof r.order_item_id === "undefined") {
  //         throw new Error("Each refund entry must include order_item_id and refunded_amount");
  //       }
  //       const id = Number(r.order_item_id);
  //       const amt = Number(r.refunded_amount);
  //       if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid order_item_id in refunds");
  //       if (!Number.isFinite(amt) || amt <= 0) throw new Error("Invalid refunded_amount for item " + id);

  //       if (seen.has(id)) {
  //         const ex = normalized.find(x => x.order_item_id === id);
  //         ex.refunded_amount = Number((ex.refunded_amount + amt).toFixed(2));
  //       } else {
  //         normalized.push({ order_item_id: id, refunded_amount: Number(amt.toFixed(2)) });
  //         seen.add(id);
  //       }
  //     }

  //     // 1️⃣ Fetch & lock payment row
  //     const [paymentRows] = await conn.query(
  //       `SELECT payment_id, payment_method, COALESCE(refunded_total,0) AS refunded_total, COALESCE(amount,0) AS amount
  //        FROM payments
  //        WHERE order_id = ?
  //        FOR UPDATE`,
  //       [order_id]
  //     );
  //     const payment = paymentRows[0];
  //     if (!payment) throw new Error("Payment record not found for this order");

  //     if (String(payment.payment_method).toUpperCase() === "COD") {
  //       throw new Error("Refund not allowed for COD orders");
  //     }

  //     // Already refunded fully? Stop
  //     if (Number(payment.refunded_total) >= Number(payment.amount) && payment.amount > 0) {
  //       throw new Error("Payment already fully refunded");
  //     }

  //     // 2️⃣ Confirm order exists
  //     const [[orderRow]] = await conn.query(
  //       `SELECT order_id FROM orders WHERE order_id = ?`,
  //       [order_id]
  //     );
  //     if (!orderRow) throw new Error("Order not found");

  //     let totalRefundNow = 0;
  //     const refundedItems = [];

  //     // 3️⃣ Process each CANCELLED item refund
  //     for (const r of normalized) {
  //       const itemId = r.order_item_id;
  //       const toRefund = Number(r.refunded_amount);

  //       // Lock item row
  //       const [[item]] = await conn.query(
  //         `SELECT order_item_id, refunded_amount, subtotal, item_status
  //          FROM order_items
  //          WHERE order_id = ? AND order_item_id = ?
  //          FOR UPDATE`,
  //         [order_id, itemId]
  //       );

  //       if (!item) throw new Error(`Item ${itemId} not found for this order`);

  //       // ❌ Only CANCELLED items allowed
  //       if (item.item_status !== "CANCELLED") {
  //         throw new Error(`Item ${itemId} must be CANCELLED before refund`);
  //       }

  //       const alreadyRefunded = Number(item.refunded_amount || 0);
  //       const subtotal = Number(item.subtotal || 0);

  //       if (alreadyRefunded >= subtotal) {
  //         throw new Error(`Item ${itemId} already fully refunded`);
  //       }

  //       if (alreadyRefunded + toRefund > subtotal) {
  //         throw new Error(
  //           `Refund exceeds subtotal for item ${itemId}. remaining: ${(subtotal - alreadyRefunded).toFixed(2)}`
  //         );
  //       }

  //       // Refund this cancelled item
  //       await conn.query(
  //         `UPDATE order_items
  //          SET refunded_amount = refunded_amount + ?, item_status = 'REFUNDED'
  //          WHERE order_item_id = ? AND order_id = ?`,
  //         [toRefund, itemId, order_id]
  //       );

  //       totalRefundNow += toRefund;
  //       refundedItems.push({
  //         order_item_id: itemId,
  //         refunded_amount: toRefund,
  //         previously_refunded: alreadyRefunded,
  //         subtotal
  //       });
  //     }

  //     // 4️⃣ money update only - payment refunded_total
  //     const newRefundedTotal = Number(payment.refunded_total || 0) + totalRefundNow;
  //     await conn.query(
  //       `UPDATE payments SET refunded_total = ? WHERE payment_id = ?`,
  //       [newRefundedTotal, payment.payment_id]
  //     );

  //     // 5️⃣ Check if all refund-eligible items are now refunded
  //     const [[itemCheck]] = await conn.query(
  //       `SELECT
  //          SUM(CASE WHEN item_status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_items,
  //          SUM(CASE WHEN item_status = 'REFUNDED' THEN 1 ELSE 0 END) AS refunded_items
  //        FROM order_items
  //        WHERE order_id = ?`,
  //       [order_id]
  //     );

  //     const fullyRefunded = Number(itemCheck.cancelled_items) === Number(itemCheck.refunded_items);

  //     // 6️⃣ Update order + payment status
  //     const newPaymentStatus = fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED";
  //     await conn.query(
  //       `UPDATE payments SET status = ? WHERE payment_id = ?`,
  //       [newPaymentStatus, payment.payment_id]
  //     );

  //     const newOrderStatus = fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED";
  //     await conn.query(
  //       `UPDATE orders SET order_status = ? WHERE order_id = ?`,
  //       [newOrderStatus, order_id]
  //     );

  //     await conn.commit();

  //     return {
  //       success: true,
  //       message: fullyRefunded ? "Full cancel refund processed" : "Partial cancel refund processed",
  //       refunded_now: Number(totalRefundNow.toFixed(2)),
  //       payment_refunded_total: Number(newRefundedTotal.toFixed(2)),
  //       items: refundedItems,
  //       fully_refunded: fullyRefunded
  //     };

  //   } catch (err) {
  //     await conn.rollback();
  //     throw new Error(err?.message || err);
  //   } finally {
  //     try { conn.release(); } catch (_) {}
  //   }
  // },

  // recordRefundCancel: async (order_id, refunds = []) => {
  //   const conn = await pool.getConnection();
  //   try {
  //     await conn.beginTransaction();

  //     // --- Validate basic input
  //     if (!order_id) throw new Error("order_id is required");
  //     if (!Array.isArray(refunds) || refunds.length === 0) {
  //       throw new Error("refunds array is required and cannot be empty");
  //     }

  //     // Normalize + merge duplicate refund items
  //     const normalized = [];
  //     const seen = new Set();
  //     for (const r of refunds) {
  //       if (!r || typeof r.order_item_id === "undefined") {
  //         throw new Error("Each refund entry must include order_item_id + refunded_amount");
  //       }
  //       const id = Number(r.order_item_id);
  //       const amt = Number(r.refunded_amount);
  //       if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid order_item_id");
  //       if (!Number.isFinite(amt) || amt <= 0) throw new Error("Invalid refunded_amount for item " + id);

  //       if (seen.has(id)) {
  //         const ex = normalized.find(x => x.order_item_id === id);
  //         ex.refunded_amount = Number((ex.refunded_amount + amt).toFixed(2));
  //       } else {
  //         normalized.push({ order_item_id: id, refunded_amount: Number(amt.toFixed(2)) });
  //         seen.add(id);
  //       }
  //     }

  //     // 1️⃣ Payment row + lock
  //     const [paymentRows] = await conn.query(
  //       `SELECT payment_id, COALESCE(refunded_total,0) AS refunded_total
  //        FROM payments
  //        WHERE order_id = ?
  //        FOR UPDATE`,
  //       [order_id]
  //     );
  //     const payment = paymentRows[0];
  //     if (!payment) throw new Error("Payment record not found");

  //     // 2️⃣ Ensure order exists
  //     const [[orderRow]] = await conn.query(
  //       `SELECT order_id FROM orders WHERE order_id = ?`,
  //       [order_id]
  //     );
  //     if (!orderRow) throw new Error("Order not found");

  //     let totalRefundNow = 0;
  //     const refundedItems = [];

  //     // 3️⃣ Process each refundable (CANCELLED) item
  //     for (const r of normalized) {
  //       const itemId = r.order_item_id;
  //       const toRefund = Number(r.refunded_amount);

  //       const [[item]] = await conn.query(
  //         `SELECT order_item_id, refunded_amount, item_status
  //          FROM order_items
  //          WHERE order_id = ? AND order_item_id = ?
  //          FOR UPDATE`,
  //         [order_id, itemId]
  //       );

  //       if (!item) throw new Error(`Item ${itemId} not found`);
  //       if (item.item_status !== "CANCELLED") {
  //         throw new Error(`Item ${itemId} must be CANCELLED before refund`);
  //       }

  //       await conn.query(
  //         `UPDATE order_items
  //          SET refunded_amount = refunded_amount + ?, item_status = 'REFUNDED'
  //          WHERE order_item_id = ? AND order_id = ?`,
  //         [toRefund, itemId, order_id]
  //       );

  //       totalRefundNow += toRefund;
  //       refundedItems.push({
  //         order_item_id: itemId,
  //         refunded_amount: toRefund,
  //         previously_refunded: Number(item.refunded_amount || 0)
  //       });
  //     }

  //     // 4️⃣ Update money refunded (only add what we sent)
  //     const newRefundedTotal = Number(payment.refunded_total || 0) + totalRefundNow;
  //     await conn.query(
  //       `UPDATE payments SET refunded_total = ? WHERE payment_id = ?`,
  //       [newRefundedTotal, payment.payment_id]
  //     );

  //     // 5️⃣ FULL Refund Check (ONLY BASED ON CANCELLED ITEMS)
  //     const [[refundCheck]] = await conn.query(
  //       `SELECT
  //           SUM(CASE WHEN item_status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_items,
  //           SUM(CASE WHEN item_status = 'REFUNDED' THEN 1 ELSE 0 END) AS refunded_items
  //        FROM order_items
  //        WHERE order_id = ?`,
  //       [order_id]
  //     );

  //     // ✔ FULL Refund = No cancelled items left (all are refunded)
  //     const fullyRefunded =
  //       Number(refundCheck.cancelled_items) === 0 &&
  //       Number(refundCheck.refunded_items) > 0;

  //     // 6️⃣ Update payment + order status
  //     const newPaymentStatus = fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED";
  //     await conn.query(
  //       `UPDATE payments SET status = ? WHERE payment_id = ?`,
  //       [newPaymentStatus, payment.payment_id]
  //     );

  //     const newOrderStatus = fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED";
  //     await conn.query(
  //       `UPDATE orders SET order_status = ? WHERE order_id = ?`,
  //       [newOrderStatus, order_id]
  //     );

  //     await conn.commit();

  //     return {
  //       success: true,
  //       message: fullyRefunded ? "Full cancel refund processed" : "Partial cancel refund processed",
  //       refunded_now: Number(totalRefundNow.toFixed(2)),
  //       payment_refunded_total: Number(newRefundedTotal.toFixed(2)),
  //       items: refundedItems,
  //       fully_refunded: fullyRefunded
  //     };

  //   } catch (err) {
  //     await conn.rollback();
  //     throw new Error(err?.message || err);
  //   } finally {
  //     try { conn.release(); } catch (_) {}
  //   }
  // },

  recordRefundCancel: async (order_id, refunds = []) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // --- Validate basic input
      if (!order_id) throw new Error("order_id is required");
      if (!Array.isArray(refunds) || refunds.length === 0) {
        throw new Error("refunds array is required and cannot be empty");
      }

      // Normalize + merge duplicate refund items
      const normalized = [];
      const seen = new Set();
      for (const r of refunds) {
        if (!r || typeof r.order_item_id === "undefined") {
          throw new Error("Each refund entry must include order_item_id + refunded_amount");
        }
        const id = Number(r.order_item_id);
        const amt = Number(r.refunded_amount);
        if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid order_item_id");
        if (!Number.isFinite(amt) || amt <= 0) throw new Error("Invalid refunded_amount for item " + id);

        if (seen.has(id)) {
          const ex = normalized.find(x => x.order_item_id === id);
          ex.refunded_amount = Number((ex.refunded_amount + amt).toFixed(2));
        } else {
          normalized.push({ order_item_id: id, refunded_amount: Number(amt.toFixed(2)) });
          seen.add(id);
        }
      }

      // 1️⃣ Payment row + lock
      const [paymentRows] = await conn.query(
        `SELECT payment_id, COALESCE(refunded_total,0) AS refunded_total
       FROM payments
       WHERE order_id = ?
       FOR UPDATE`,
        [order_id]
      );
      const payment = paymentRows[0];
      if (!payment) throw new Error("Payment record not found");

      // 2️⃣ Ensure order exists
      const [[orderRow]] = await conn.query(
        `SELECT order_id FROM orders WHERE order_id = ?`,
        [order_id]
      );
      if (!orderRow) throw new Error("Order not found");

      let totalRefundNow = 0;
      const refundedItems = [];

      // 3️⃣ Process each refundable (CANCELLED) item
      for (const r of normalized) {
        const itemId = r.order_item_id;
        const toRefund = Number(r.refunded_amount);

        const [[item]] = await conn.query(
          `SELECT order_item_id, refunded_amount, item_status
         FROM order_items
         WHERE order_id = ? AND order_item_id = ?
         FOR UPDATE`,
          [order_id, itemId]
        );

        if (!item) throw new Error(`Item ${itemId} not found`);
        if (item.item_status !== "CANCELLED") {
          throw new Error(`Item ${itemId} must be CANCELLED before refund`);
        }

        // 3️⃣.1 Get subtotal (price * qty)
        const [[price]] = await conn.query(
          `SELECT (price * quantity) AS subtotal
         FROM order_items 
         WHERE order_id = ? AND order_item_id = ?`,
          [order_id, itemId]
        );

        // 3️⃣.2 Update item refund + status
        await conn.query(
          `UPDATE order_items
         SET refunded_amount = refunded_amount + ?, item_status = 'REFUNDED'
         WHERE order_item_id = ? AND order_id = ?`,
          [toRefund, itemId, order_id]
        );

        // 3️⃣.3 Deduct refunded money from order total
        await conn.query(
          `UPDATE orders 
         SET total_amount = total_amount - ? 
         WHERE order_id = ?`,
          [toRefund, order_id]
        );

        totalRefundNow += toRefund;
        refundedItems.push({
          order_item_id: itemId,
          refunded_amount: toRefund,
          previously_refunded: Number(item.refunded_amount || 0)
        });
      }

      // 4️⃣ Update money refunded in payments
      const newRefundedTotal = Number(payment.refunded_total || 0) + totalRefundNow;
      await conn.query(
        `UPDATE payments SET refunded_total = ? WHERE payment_id = ?`,
        [newRefundedTotal, payment.payment_id]
      );

      // 5️⃣ FULL Refund Check (any item still not refunded?)
      const [[remaining]] = await conn.query(
        `SELECT COUNT(*) AS pending_items
       FROM order_items
       WHERE order_id = ?
       AND item_status NOT IN ('REFUNDED')`,
        [order_id]
      );

      const fullyRefunded = Number(remaining.pending_items) === 0;

      // 6️⃣ Update payment + order status
      const newPaymentStatus = fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED";
      await conn.query(
        `UPDATE payments SET status = ? WHERE payment_id = ?`,
        [newPaymentStatus, payment.payment_id]
      );

      const newOrderStatus = fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED";
      await conn.query(
        `UPDATE orders SET order_status = ? WHERE order_id = ?`,
        [newOrderStatus, order_id]
      );

      await conn.commit();

      return {
        success: true,
        message: fullyRefunded ? "Full cancel refund processed" : "Partial cancel refund processed",
        refunded_now: Number(totalRefundNow.toFixed(2)),
        payment_refunded_total: Number(newRefundedTotal.toFixed(2)),
        items: refundedItems,
        fully_refunded: fullyRefunded
      };

    } catch (err) {
      await conn.rollback();
      throw new Error(err?.message || err);
    } finally {
      try { conn.release(); } catch (_) { }
    }
  },




  recordRefundReturn: async (order_id, refunds = []) => {
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // --- Validate basic input
      if (!order_id) throw new Error("order_id is required");
      if (!Array.isArray(refunds) || refunds.length === 0) {
        throw new Error("refunds array is required and cannot be empty");
      }

      // Normalize and validate refunds input (dedupe and ensure numbers)
      const normalized = [];
      const seen = new Set();
      for (const r of refunds) {
        if (!r || typeof r.order_item_id === "undefined") {
          throw new Error("Each refund entry must include order_item_id and refunded_amount");
        }
        const id = Number(r.order_item_id);
        const amt = Number(r.refunded_amount);
        if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid order_item_id in refunds");
        if (!Number.isFinite(amt) || amt <= 0) throw new Error("Invalid refunded_amount for item " + id);

        if (seen.has(id)) {
          // If duplicates provided, accumulate them into one entry
          const ex = normalized.find(x => x.order_item_id === id);
          ex.refunded_amount = Number((ex.refunded_amount + amt).toFixed(2));
        } else {
          normalized.push({ order_item_id: id, refunded_amount: Number(amt.toFixed(2)) });
          seen.add(id);
        }
      }

      // 1️⃣ Fetch & lock payment row
      const [paymentRows] = await conn.query(
        `SELECT payment_id, payment_method, COALESCE(refunded_total,0) AS refunded_total, COALESCE(amount,0) AS amount
       FROM payments
       WHERE order_id = ?
       FOR UPDATE`,
        [order_id]
      );
      const payment = paymentRows[0];
      if (!payment) throw new Error("Payment record not found for this order");


      // If payment already fully refunded, block further refunds
      if (Number(payment.refunded_total) >= Number(payment.amount) && Number(payment.amount) > 0) {
        throw new Error("Payment already fully refunded");
      }

      // 2️⃣ Ensure order exists (lock not necessary here, we lock items below)
      const [[orderRow]] = await conn.query(
        `SELECT order_id FROM orders WHERE order_id = ?`,
        [order_id]
      );
      if (!orderRow) throw new Error("Order not found");

      let totalRefundNow = 0;
      const refundedItems = []; // details to return

      // 3️⃣ Process each refunded item with row-level lock to avoid races
      for (const r of normalized) {
        const itemId = r.order_item_id;
        const toRefund = Number(r.refunded_amount);

        // Fetch the item row FOR UPDATE (locks the row in the transaction)
        const [[item]] = await conn.query(
          `SELECT order_item_id, refunded_amount, subtotal, item_status
         FROM order_items
         WHERE order_id = ? AND order_item_id = ?
         FOR UPDATE`,
          [order_id, itemId]
        );

        if (!item) {
          throw new Error(`Item ${itemId} not found for order ${order_id}`);
        }

        // ❌ Do not allow refund for cancelled items
        if (item.item_status === "CANCELLED") {
          throw new Error(`Item ${itemId} is cancelled and cannot be refunded`);
        }

        const alreadyRefunded = Number(item.refunded_amount || 0);
        const subtotal = Number(item.subtotal || 0);

        // If already fully refunded, disallow any further refunds for that item
        if (alreadyRefunded >= subtotal) {
          throw new Error(`Item ${itemId} is already fully refunded`);
        }

        // Prevent over-refund (sum of already refunded + new refunded <= subtotal)
        if (alreadyRefunded + toRefund > subtotal) {
          throw new Error(
            `Refund would exceed item subtotal for item ${itemId}. remaining refundable: ${(subtotal - alreadyRefunded).toFixed(2)}`
          );
        }

        // Update refunded_amount and mark item_status = 'REFUNDED' (single item refund)
        await conn.query(
          `UPDATE order_items
         SET refunded_amount = refunded_amount + ?, item_status = 'REFUNDED'
         WHERE order_item_id = ? AND order_id = ?`,
          [toRefund, itemId, order_id]
        );

        totalRefundNow += toRefund;
        refundedItems.push({
          order_item_id: itemId,
          refunded_amount: toRefund,
          previously_refunded: alreadyRefunded,
          subtotal
        });
      }

      // 4️⃣ Update payment.refunded_total (money only)
      const newRefundedTotal = Number(payment.refunded_total || 0) + totalRefundNow;

      await conn.query(
        `UPDATE payments
       SET refunded_total = ?
       WHERE payment_id = ?`,
        [newRefundedTotal, payment.payment_id]
      );

      // 5️⃣ Determine FULL vs PARTIAL based on item count (item-based rule)
      const [[itemCheck]] = await conn.query(
        `SELECT
         COUNT(*) AS total_items,
         SUM(CAST(refunded_amount AS DECIMAL(10,2)) > 0) AS refunded_items
       FROM order_items
       WHERE order_id = ?`,
        [order_id]
      );

      const fullyRefunded = Number(itemCheck.total_items) === Number(itemCheck.refunded_items);

      // 6️⃣ If fully refunded, ensure all items are set to refunded (idempotent)
      if (fullyRefunded) {
        await conn.query(
          `UPDATE order_items
         SET item_status = 'REFUNDED'
         WHERE order_id = ?`,
          [order_id]
        );
      }

      // 7️⃣ Update payments.status and orders.order_status according to item-based rule
      const newPaymentStatus = fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED";
      await conn.query(
        `UPDATE payments SET status = ? WHERE payment_id = ?`,
        [newPaymentStatus, payment.payment_id]
      );

      const newOrderStatus = fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED";
      await conn.query(
        `UPDATE orders SET order_status = ? WHERE order_id = ?`,
        [newOrderStatus, order_id]
      );

      await conn.commit();

      return {
        success: true,
        message: fullyRefunded ? "Full refund processed" : "Partial refund processed",
        refunded_now: Number(totalRefundNow.toFixed(2)),
        payment_refunded_total: Number(newRefundedTotal.toFixed(2)),
        items: refundedItems,
        fully_refunded: fullyRefunded
      };

    } catch (err) {
      await conn.rollback();
      // Provide structured error for API consumers
      const e = err && err.message ? err.message : String(err);
      // Re-throw as an Error object with message so your controller can handle HTTP status
      throw new Error(e);
    } finally {
      try { conn.release(); } catch (_) { }
    }
  },

  listOrders: async ({ page = 1, limit = 20, status } = {}) => {
    try {
      const offset = (page - 1) * limit;
      let sql = `SELECT * FROM orders`;
      const params = [];

      if (status) {
        sql += ` WHERE order_status = ?`;
        params.push(status);
      }

      sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(parseInt(limit, 10), parseInt(offset, 10));

      const [rows] = await pool.query(sql, params);
      return rows;
    } catch (err) {
      logger.error("List Orders Error:", err);
      throw new Error("Error listing orders");
    }
  },



  // Get All Pending Orders
  getAllPendingOrders: async ({ page = 1, limit = 20, search = "" }) => {
    return await fetchOrdersByStatus("PENDING", page, limit, search);
  },

  // 🔵 Get All Confirmed Orders
  getAllConfirmedOrders: async ({ page = 1, limit = 20, search = "" }) => {
    return await fetchOrdersByStatus("CONFIRMED", page, limit, search);
  },

  // 🟣 Get All Shipped Orders
  getAllShippedOrders: async ({ page = 1, limit = 20, search = "" }) => {
    return await fetchOrdersByStatus("SHIPPED", page, limit, search);
  },

  // 🟢 Get All Delivered Orders
  getAllDeliveredOrders: async ({ page = 1, limit = 20, search = "" }) => {
    return await fetchOrdersByStatus("DELIVERED", page, limit, search);
  },

  // 🔴 Get All Returned Orders
  getAllReturnedOrders: async ({ page = 1, limit = 20, search = "" }) => {
    return await fetchOrdersByStatus("RETURNED", page, limit, search);
  },

  getAllPartiallyReturnedOrders: async ({ page = 1, limit = 20, search = "" }) => {
    return await fetchOrdersByStatus("PARTIALLY_RETURNED", page, limit, search);
  },
  getAllReturnRequestOrders: async ({ page = 1, limit = 20, search = "" }) => {
    return await fetchOrdersByStatus("RETURN_REQUESTED", page, limit, search);
  },
  // ⚫ Get All Cancelled Orders
  getAllCancelledOrders: async ({ page = 1, limit = 20, search = "" }) => {
    return await fetchOrdersByStatus("CANCELLED", page, limit, search);
  },

  getAllPartiallyCancelledOrders: async ({ page = 1, limit = 20, search = "" }) => {
    return await fetchOrdersByStatus("PARTIALLY_CANCELLED", page, limit, search);
  },

  getAllRefundedOrders: async ({ page = 1, limit = 20, search = "" }) => {
    return await fetchOrdersByStatus("REFUNDED", page, limit, search);
  },

  getAllPartiallyRefundedOrders: async ({ page = 1, limit = 20, search = "" }) => {
    return await fetchOrdersByStatus("PARTIALLY_REFUNDED", page, limit, search);
  },

};

// 🧠 Common reusable function for all order-status-based queries
// async function fetchOrdersByStatus(status, page = 1, limit = 20, search = "") {
//   try {
//     const offset = (page - 1) * limit;
//     const params = [];
//     let whereClauses = [`o.order_status = ?`];
//     params.push(status);

//     // 🔍 Search filter
//     if (search) {
//       whereClauses.push(
//         `(o.order_id LIKE ? OR o.shipping_name LIKE ? OR o.shipping_phone LIKE ? OR o.order_coupon_code LIKE ? OR p.transaction_id LIKE ?)`
//       );
//       const s = `%${search}%`;
//       params.push(s, s, s, s, s);
//     }

//     const whereSQL = `WHERE ${whereClauses.join(" AND ")}`;

//     // 1️⃣ Fetch orders
//     const [orders] = await pool.query(
//       `
//       SELECT 
//         o.order_id,
//         o.user_id,
//         o.shipping_name,
//         o.shipping_phone,
//         o.shipping_city,
//         o.shipping_state,
//         o.total_amount,
//         o.total_discount_amount,
//         o.total_shipping_price,
//         o.order_status,
//         o.order_coupon_code,
//         o.order_coupon_id,
//         o.created_at,
//         o.updated_at,
//         p.status AS payment_status,
//         p.payment_method,
//         p.payment_gateway
//       FROM orders o
//       LEFT JOIN payments p ON o.order_id = p.order_id
//       ${whereSQL}
//       ORDER BY o.created_at DESC
//       LIMIT ? OFFSET ?
//       `,
//       [...params, parseInt(limit, 10), parseInt(offset, 10)]
//     );

//     if (!orders.length) {
//       return { orders: [], total: 0, page, limit, totalPages: 0 };
//     }

//     // 2️⃣ Count total
//     const [countRows] = await pool.query(
//       `
//       SELECT COUNT(*) AS total
//       FROM orders o
//       LEFT JOIN payments p ON o.order_id = p.order_id
//       ${whereSQL}
//       `,
//       params
//     );
//     const total = countRows[0]?.total || 0;

//     // 3️⃣ Fetch items
//     const orderIds = orders.map((o) => o.order_id);
//     const [items] = await pool.query(
//       `
//       SELECT 
//         oi.order_item_id,
//         oi.order_id,
//         oi.product_id,
//         p.name AS product_name,
//         v.variant_name,
//         oi.quantity,
//         oi.price,
//         oi.subtotal
//       FROM order_items oi
//       JOIN products p ON p.id = oi.product_id
//       JOIN product_variants v ON v.id = oi.variant_id
//       WHERE oi.order_id IN (?)
//       ORDER BY oi.order_id
//       `,
//       [orderIds]
//     );

//     // 4️⃣ Group items under orders
//     const orderMap = {};
//     orders.forEach((o) => {
//       orderMap[o.order_id] = { ...o, items: [] };
//     });

//     items.forEach((item) => {
//       if (orderMap[item.order_id]) {
//         orderMap[item.order_id].items.push({
//           order_item_id: item.order_item_id,
//           product_id: item.product_id,
//           product_name: item.product_name,
//           variant_name: item.variant_name,
//           quantity: item.quantity,
//           price: item.price,
//           subtotal: item.subtotal,
//         });
//       }
//     });

//     // ✅ Final response
//     return {
//       page,
//       limit,
//       total,
//       totalPages: Math.ceil(total / limit),
//       orders: Object.values(orderMap),
//     };
//   } catch (err) {
//     logger.error(`Get Orders by Status (${status}) Error:`, err);
//     throw new Error(`Error fetching ${status.toLowerCase()} orders`);
//   }
// };


async function fetchOrdersByStatus(status, page = 1, limit = 20, search = "") {
  try {
    const offset = (page - 1) * limit;
    const params = [];
    let whereClauses = [`o.order_status = ?`];
    params.push(status);

    // 🔍 Search filter
    if (search) {
      whereClauses.push(`
        (o.order_id LIKE ? 
        OR o.shipping_name LIKE ? 
        OR o.shipping_phone LIKE ? 
        OR o.order_coupon_code LIKE ? 
        OR p.transaction_id LIKE ?)
      `);
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }

    const whereSQL = `WHERE ${whereClauses.join(" AND ")}`;

    // 1️⃣ Fetch all orders with all details
    const [orders] = await pool.query(
      `
      SELECT 
        o.order_id,
        o.user_id,
        o.address_id,
        o.shipping_name,
        o.shipping_phone,
        o.shipping_street,
        o.shipping_city,
        o.shipping_state,
        o.shipping_zip,
        o.shipping_country,
        o.gst_number,
        o.total_amount,
        o.total_discount_amount,
        o.total_shipping_price,
        o.order_status,
        o.order_coupon_id,
        o.order_coupon_code,
        o.courier_name,
        o.courier_tracking_id,
        o.date_of_shipment,
        o.cod_charge,
        o.cod_charge_type,
        o.cod_charge_rate,
        o.additional_charge,
        o.additional_charge_type,
        o.additional_charge_rate,
        o.created_at,
        o.updated_at,
        p.status AS payment_status,
        p.payment_method,
        p.payment_gateway,
        p.transaction_id
      FROM orders o
      LEFT JOIN payments p ON o.order_id = p.order_id
      ${whereSQL}
      ORDER BY o.order_id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, parseInt(limit, 10), parseInt(offset, 10)]
    );

    if (!orders.length) {
      return { orders: [], total: 0, page, limit, totalPages: 0 };
    }

    // 2️⃣ Count total
    const [countRows] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM orders o
      LEFT JOIN payments p ON o.order_id = p.order_id
      ${whereSQL}
      `,
      params
    );
    const total = countRows[0]?.total || 0;

    // 3️⃣ Fetch order items (all fields)
    const orderIds = orders.map((o) => o.order_id);
    const [items] = await pool.query(
      `
      SELECT 
        oi.order_item_id,
        oi.order_id,
        oi.product_id,
        p.name AS product_name,
        v.variant_name,
        oi.variant_id,
        v.sku,
        oi.quantity,
        oi.price,
        oi.subtotal,
        oi.per_item_discount,
        oi.coupon_code,
        oi.shipping_price,
        oi.shipping_message,
        oi.coupon_id,
        oi.deal_id,
        oi.is_deal_applied,
        oi.item_status,
        oi.refunded_amount,
        oi.refunded_at,
        oi.admin_note
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN product_variants v ON v.id = oi.variant_id
      WHERE oi.order_id IN (?)
      ORDER BY oi.order_id
      `,
      [orderIds]
    );

    // 4️⃣ Group items under their respective orders
    // 4️⃣ Create finalOrders array while preserving SQL order
    const finalOrders = orders.map((order) => {
      return {
        ...order,
        items: []
      };
    });

    // 5️⃣ Attach items to correct order without breaking order
    items.forEach((item) => {
      const targetOrder = finalOrders.find(o => o.order_id === item.order_id);
      if (targetOrder) {
        targetOrder.items.push({
          order_item_id: item.order_item_id,
          product_id: item.product_id,
          variant_id: item.variant_id,
          product_name: item.product_name,
          variant_name: item.variant_name,
          sku: item.sku,
          quantity: item.quantity,
          price: item.price,
          subtotal: item.subtotal,
          per_item_discount: item.per_item_discount,
          coupon_code: item.coupon_code,
          shipping_price: item.shipping_price,
          shipping_message: item.shipping_message,
          coupon_id: item.coupon_id,
          deal_id: item.deal_id,
          is_deal_applied: item.is_deal_applied,
          item_status: item.item_status,
          refunded_amount: item.refunded_amount,
          refunded_at: item.refunded_at,
          admin_note: item.admin_note
        });
      }
    });

    // 6️⃣ Return correct sorted data
    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      orders: finalOrders   // 🚀 ORDER PRESERVED
    };
  } catch (err) {
    logger.error(`❌ Get Orders by Status (${status}) Error:`, err);
    throw new Error(`Error fetching ${status.toLowerCase()} orders`);
  }
};

module.exports = orderModel;
