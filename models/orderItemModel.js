const logger = require("../utils/logger");
// src/models/orderItemModel.js
const pool = require("../config/db");
const Order = require("./orderModel");

const orderItemModel = {
  createOrderItem: async ({ conn, order_id, product_id, variant_id, quantity, price, shipping_price = 0, shipping_message = null }) => {
    try {
      const subtotal = Number((price * quantity).toFixed(2));

      const sql = `
        INSERT INTO order_items
        (order_id, product_id, variant_id, quantity, price, subtotal, shipping_price, shipping_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const params = [order_id, product_id, variant_id, quantity, price, subtotal, shipping_price, shipping_message];

      const [result] = conn
        ? await conn.query(sql, params)
        : await pool.query(sql, params);

      return { order_item_id: result.insertId };
    } catch (err) {
      logger.error("Create OrderItem Error:", err);
      throw new Error("Error creating order item");
    }
  },

  getItemsByOrder: async (order_id) => {
    try {
      const [rows] = await pool.query(`SELECT * FROM order_items WHERE order_id = ?`, [order_id]);
      return rows;
    } catch (err) {
      logger.error("Get OrderItems Error:", err);
      throw new Error("Error fetching order items");
    }
  },

  releaseItemsStock: async (order_id) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.query(`SELECT variant_id, quantity FROM order_items WHERE order_id = ?`, [order_id]);

      for (const it of rows) {
        await conn.query(`UPDATE product_variants SET stock = stock + ? WHERE id = ?`, [it.quantity, it.variant_id]);
      }

      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      logger.error("Release Items Stock Error:", err);
      throw new Error("Error releasing stock for order items");
    } finally {
      conn.release();
    }
  }
};

module.exports = orderItemModel;
