const logger = require("../utils/logger");
const pool = require("../config/db");

const stockService = {
  // 🔹 Reserve stock (temporary hold for ONLINE before payment)
  async reserveStock(items, conn) {
    for (const item of items) {
      const [rows] = await conn.query(
        `SELECT stock FROM product_variants WHERE id = ? FOR UPDATE`,
        [item.variant_id]
      );
      if (!rows.length) throw new Error(`Variant ${item.variant_id} not found`);
      if (rows[0].stock < item.quantity)
        throw new Error(`Insufficient stock for variant ${item.variant_id}`);

      await conn.query(
        `UPDATE product_variants SET stock = stock - ? WHERE id = ?`,
        [item.quantity, item.variant_id]
      );
    }
  },

  // 🔹 Confirm stock (already reserved; do nothing extra)
  async confirmStock(order_id, conn) {
    logger.info(`[Stock] Order ${order_id} confirmed (no action needed).`);
  },

  // 🔹 Release stock (on cancel/fail)
  async releaseStock(order_id, conn = null) {
    const localConn = conn || (await pool.getConnection());
    let releaseLocal = !conn;
    try {
      const [items] = await localConn.query(
        `SELECT variant_id, quantity FROM order_items WHERE order_id = ?`,
        [order_id]
      );
      if (!items.length) {
        logger.warn(`[Stock] No order_items found for ${order_id}`);
        return;
      }
      for (const it of items) {
        await localConn.query(
          `UPDATE product_variants SET stock = stock + ? WHERE id = ?`,
          [it.quantity, it.variant_id]
        );
      }
      logger.info(`[Stock] Released stock for order ${order_id}`);
    } catch (err) {
      logger.error(`[Stock] Release failed for order ${order_id}:`, err);
      throw err;
    } finally {
      if (releaseLocal) localConn.release();
    }
  },
};

module.exports = stockService;
