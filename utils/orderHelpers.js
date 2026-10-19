const pool = require("../config/db");
const couponModel = require("../models/couponModel");

exports.releaseStockForOrder = async (conn, order_id) => {
  // Fetch all items for this order
  const [items] = await conn.query(
    `SELECT variant_id, quantity FROM order_items WHERE order_id = ?`,
    [order_id]
  );

  for (const it of items) {
    await conn.query(
      `UPDATE product_variants SET stock = stock + ? WHERE id = ?`,
      [it.quantity, it.variant_id]
    );
  }

  return items.length;
};

exports.revertCouponsForCancelledItems = async (conn, order_id, cancelled_item_ids) => {
  if (!cancelled_item_ids || cancelled_item_ids.length === 0) return 0;

  // 1️⃣ Fetch coupon usages for only cancelled items
  const [usedCoupons] = await conn.query(
    `
      SELECT coupon_id, order_item_id 
      FROM coupon_usages 
      WHERE order_id = ? 
      AND order_item_id IN (?) 
      AND status = 'USED'
    `,
    [order_id, cancelled_item_ids]
  );

  if (!usedCoupons.length) return 0;

  // 2️⃣ Revert each coupon usage
  for (const row of usedCoupons) {
    const cid = row.coupon_id;
    if (!cid) continue;

    // Mark coupon usage as reverted for that item
    await conn.query(
      `
        UPDATE coupon_usages
        SET status = 'REVERTED', reverted_at = NOW()
        WHERE order_id = ? AND order_item_id = ? AND coupon_id = ? AND status = 'USED'
      `,
      [order_id, row.order_item_id, cid]
    );

    // Increase coupon usage limit (1 per cancelled item)
    await conn.query(
      `UPDATE coupons SET usage_limit = usage_limit + 1 WHERE id = ?`,
      [cid]
    );
  }

  return usedCoupons.length;
};


exports.revertCouponsForOrder = async (conn, order_id) => {
  // Get coupons used in this order
  const [usedCoupons] = await conn.query(
    `SELECT DISTINCT coupon_id FROM coupon_usages WHERE order_id = ? AND status = 'USED'`,
    [order_id]
  );

  for (const r of usedCoupons) {
    const cid = r.coupon_id;
    if (!cid) continue;

    await conn.query(
      `UPDATE coupon_usages 
       SET status = 'REVERTED', reverted_at = NOW() 
       WHERE order_id = ? AND coupon_id = ? AND status = 'USED'`,
      [order_id, cid]
    );

    await conn.query(
      `UPDATE coupons SET usage_limit = usage_limit + 1 WHERE id = ?`,
      [cid]
    );
  }

  return usedCoupons.length;
};

exports.recordCouponUsageForOrder = async (order_id) => {
  const [orderRows] = await pool.query(`SELECT user_id, order_coupon_id FROM orders WHERE order_id = ?`, [order_id]);
  if (!orderRows.length) return;

  const order = orderRows[0];
  const user_id = order.user_id;
  const order_coupon_id = order.order_coupon_id;

  const [items] = await pool.query(`SELECT order_item_id, coupon_id FROM order_items WHERE order_id = ?`, [order_id]);

  for (const it of items) {
    if (it.coupon_id) {
      await couponModel.recordCouponUsage(it.coupon_id, user_id, order_id, it.order_item_id);
      await pool.query(
        `UPDATE coupons SET usage_limit = usage_limit - 1 WHERE id = ? AND usage_limit > 0`,
        [it.coupon_id]
      );
    }
  }

  if (order_coupon_id) {
    await couponModel.recordCouponUsage(order_coupon_id, user_id, order_id, null);
    await pool.query(
      `UPDATE coupons SET usage_limit = usage_limit - 1 WHERE id = ? AND usage_limit > 0`,
      [order_coupon_id]
    );
  }
};
