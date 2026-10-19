const logger = require("../utils/logger");
// src/models/paymentModel.js
const pool = require("../config/db");


const paymentModel = {
  /**
   * Create a new payment entry (default: PENDING)
   */
  createPayment: async ({
    conn,
    order_id,
    amount,
    merchant_user_id,
    payment_method = "ONLINE",
    payment_gateway = "PhonePe",

  }) => {

    try {
      const sql = `
        INSERT INTO payments 
        (order_id, payment_method, payment_gateway, merchant_user_id, amount, status, created_at, updated_at)
        VALUES (?, ?, ?, ?,?, 'PENDING', NOW(), NOW())
      `;
      const params = [order_id, payment_method, payment_gateway, merchant_user_id, amount];

          logger.info(merchant_user_id)


      const [result] = conn
        ? await conn.query(sql, params)
        : await pool.query(sql, params);

      return { payment_id: result.insertId };
    } catch (err) {
      logger.error("Create Payment Error:", err);
      throw new Error("Error creating payment");
    }
  },

  /**
   * Save transaction_id after initiating payment with gateway
   */
  saveTransactionIdByPaymentId: async (payment_id, merchant_order_id, transaction_id,) => {
  logger.info("Saving transaction:", transaction_id, merchant_order_id, payment_id);
  try {
    await pool.query(
      `UPDATE payments 
       SET transaction_id = ?, merchant_order_id = ?, updated_at = NOW() 
       WHERE payment_id = ?`,
      [transaction_id, merchant_order_id, payment_id]
    );
    return true;
  } catch (err) {
    logger.error("Save Transaction ID Error:", err);
    throw new Error("Error saving transaction ID");
  }
},

  /**
   * Update payment by order_id
   */
  updatePaymentByOrderId: async (order_id, data = {}) => {
    try {
      const { status, payment_reference, payment_response } = data;

      await pool.query(
        `UPDATE payments 
         SET status = ?, 
             payment_reference = ?, 
             payment_response = ?, 
             updated_at = NOW() 
         WHERE order_id = ?`,
        [
          status,
          payment_reference || null,
          payment_response ? JSON.stringify(payment_response) : null,
          order_id
        ]
      );
      return true;
    } catch (err) {
      logger.error("Update Payment By Order ID Error:", err);
      throw new Error("Error updating payment by order ID");
    }
  },

  /**
   * Get payment details by order_id
   */
  getPaymentByOrder: async (order_id) => {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM payments WHERE order_id = ? LIMIT 1`,
        [order_id]
      );
      return rows[0] || null;
    } catch (err) {
      logger.error("Get Payment By Order Error:", err);
      throw new Error("Error fetching payment by order ID");
    }
  },


  getPaymentByMerchantOrderId: async (merchant_order_id) => {
  const [rows] = await pool.query(
    `SELECT * FROM payments WHERE merchant_order_id = ? LIMIT 1`,
    [merchant_order_id]
  );

  return rows[0] || null;
},

  getAllPayments: async ({ page = 1, limit = 20, status = null, payment_method = null, search = "" }) => {
  try {
    const offset = (page - 1) * limit;
    const params = [];
    const whereClauses = [];

    // 🟡 Filter by payment status
    if (status) {
      whereClauses.push("p.status = ?");
      params.push(status);
    }

    // 🟢 Filter by payment method (COD / ONLINE)
    if (payment_method) {
      whereClauses.push("p.payment_method = ?");
      params.push(payment_method);
    }

    // 🔍 Search (transaction_id, merchant_order_id, merchant_user_id, payment_reference, order_id)
    if (search) {
      const s = `%${search}%`;
      whereClauses.push(`
        (p.transaction_id LIKE ? 
        OR p.merchant_order_id LIKE ? 
        OR p.merchant_user_id LIKE ? 
        OR p.payment_reference LIKE ?
        OR p.order_id LIKE ?)
      `);
      params.push(s, s, s, s, s);
    }

    const whereSQL = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    // 1️⃣ Fetch paginated payments
    const [payments] = await pool.query(
      `
      SELECT 
        p.payment_id,
        p.order_id,
        p.transaction_id,
        p.merchant_order_id,
        p.merchant_user_id,
        p.payment_method,
        p.payment_gateway,
        p.amount,
        p.refunded_total,
        p.status,
        p.payment_reference,
        p.created_at,
        p.updated_at,
        o.shipping_name,
        o.shipping_phone,
        o.order_status
      FROM payments p
      LEFT JOIN orders o ON o.order_id = p.order_id
      ${whereSQL}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, parseInt(limit, 10), parseInt(offset, 10)]
    );

    if (!payments.length) {
      return { payments: [], total: 0, page, limit, totalPages: 0 };
    }

    // 2️⃣ Count total for pagination
    const [countRows] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM payments p
      LEFT JOIN orders o ON o.order_id = p.order_id
      ${whereSQL}
      `,
      params
    );

    const total = countRows[0]?.total || 0;

    // 3️⃣ Final structured paginated response
    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      payments,
    };
  } catch (err) {
    logger.error("❌ Get All Payments (Admin) Error:", err);
    throw new Error("Error fetching admin payments");
  }
},

getPaymentById: async (payment_id) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM payments WHERE payment_id = ? LIMIT 1`,
      [payment_id]
    );
    return rows[0] || null;
  } catch (err) {
    logger.error("Get Payment By ID Error:", err);
    throw new Error("Error fetching payment by ID");
  }
},

  /**
   * Get payment details by transaction_id
   */
  getPaymentByTransactionId: async (merchant_order_id) => {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM payments WHERE merchant_order_id = ? LIMIT 1`,
        [merchant_order_id]
      );
      return rows[0] || null;
    } catch (err) {
      logger.error("Get Payment By Transaction ID Error:", err);
      throw new Error("Error fetching payment by transaction ID");
    }
  },

  /**
   * Update payment after callback/webhook
   * Used when PhonePe sends SUCCESS / FAILURE / PENDING response
   */
  setPaymentResult: async ({
    transaction_id,
    order_id,
    status,
    payment_reference,
    payment_response
  }) => {
    try {
      const sql = `
        UPDATE payments
        SET status = ?, 
            payment_reference = ?, 
            payment_response = ?, 
            updated_at = NOW()
        WHERE transaction_id = ? OR order_id = ?
      `;

      await pool.query(sql, [
        status,
        payment_reference || null,
        payment_response ? JSON.stringify(payment_response) : null,
        transaction_id,
        order_id
      ]);

      return true;
    } catch (err) {
      logger.error("Set Payment Result Error:", err);
      throw new Error("Error updating payment result");
    }
  },
  // models/paymentModel.js
getPendingPayments: async () => {
  const [rows] = await pool.query(
    `SELECT * FROM payments WHERE status = 'PENDING'`
  );
  return rows;
},


getAllPayments: async ({ page = 1, limit = 20, status, search, method, gateway } = {}) => {
  try {
    const offset = (page - 1) * limit;
    let sql = `
      SELECT 
        p.payment_id,
        p.order_id,
        p.transaction_id,
        p.merchant_order_id,
        p.merchant_user_id,
        p.payment_method,
        p.payment_gateway,
        p.amount,
        p.status,
        p.payment_reference,
        p.refunded_total,
        p.payment_response,      
        p.created_at,
        p.updated_at,
        o.order_status,
        o.total_amount,
        o.total_discount_amount,
        o.total_shipping_price,
        u.name AS user_name,
        u.email AS user_email
      FROM payments p
      LEFT JOIN orders o ON o.order_id = p.order_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE 1 = 1
    `;

    const params = [];

    // Filtering options
    if (status) {
      sql += ` AND p.status = ?`;
      params.push(status);
    }
    if (method) {
      sql += ` AND p.payment_method = ?`;
      params.push(method);
    }
    if (gateway) {
      sql += ` AND p.payment_gateway = ?`;
      params.push(gateway);
    }

    // Search by ID or transaction
    if (search) {
      sql += `
        AND (
          p.transaction_id LIKE ? OR 
          p.merchant_order_id LIKE ? OR
          p.order_id LIKE ?
        )
      `;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Sorting & pagination
    sql += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const [rows] = await pool.query(sql, params);

    // Get total count for pagination
    const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM payments`);
    const total = countRows[0]?.total || 0;

    return {
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / limit),
      data: rows,
    };
  } catch (err) {
    logger.error("❌ Get All Payments Error:", err);
    throw new Error("Error fetching payments");
  }
},


updateCODStatus: async (payment_id, status) => {
    try {
      const [result] = await pool.query(
        `UPDATE payments 
         SET status = ?, updated_at = NOW() 
         WHERE payment_id = ? AND payment_method = 'COD'`,
        [status, payment_id]
      );

      return result.affectedRows > 0;
    } catch (err) {
      logger.error("❌ Error updating COD payment status:", err);
      throw err;
    }
  },
};

module.exports = paymentModel;