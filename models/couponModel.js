const logger = require("../utils/logger");
const pool = require("../config/db");

// ---------------------
// Coupon CRUD
// ---------------------

exports.createCoupon = async (couponData, products = [], categories = [], variants = []) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO coupons
      (code, description, discount_type, discount_value, usage_limit, per_user_limit, min_order_amount, min_quantity, applies_to, priority, start_date, expiry_date, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        couponData.code,
        couponData.description || null,
        couponData.discount_type,
        couponData.discount_value,
        couponData.usage_limit ?? 0,
        couponData.per_user_limit ?? 1,
        couponData.min_order_amount ?? 0,
        couponData.min_quantity ?? null,
        couponData.applies_to || "order",
        couponData.priority ?? 1,
        couponData.start_date || new Date(),
        couponData.expiry_date,
        couponData.is_active ?? true,
      ]
    );

    const couponId = result.insertId;

    if (products.length) {
      const prodValues = products.map((p) => [couponId, p]);
      await conn.query(`INSERT INTO coupon_products (coupon_id, product_id) VALUES ?`, [prodValues]);
    }

    if (categories.length) {
      const catValues = categories.map((c) => [couponId, c]);
      await conn.query(`INSERT INTO coupon_categories (coupon_id, category_id) VALUES ?`, [catValues]);
    }

    if (variants.length) {
      const varValues = variants.map((v) => [couponId, v]);
      await conn.query(`INSERT INTO coupon_variants (coupon_id, variant_id) VALUES ?`, [varValues]);
    }

    await conn.commit();
    return couponId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

exports.getCoupons = async () => {
  const [rows] = await pool.query(`SELECT * FROM coupons ORDER BY created_at DESC`);
  return rows;
};

exports.getCouponProducts = async (couponId) => {
  const [rows] = await pool.query(
    `SELECT product_id FROM coupon_products WHERE coupon_id = ?`,
    [couponId]
  );
  return rows.map(r => r.product_id);
};

/**
 * ✅ Get all category IDs linked to a coupon
 */
exports.getCouponCategories = async (couponId) => {
  const [rows] = await pool.query(
    `SELECT category_id FROM coupon_categories WHERE coupon_id = ?`,
    [couponId]
  );
  return rows.map(r => r.category_id);
};

exports.countTotalUsage = async (coupon_id) => {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM coupon_usages WHERE coupon_id = ? AND status = 'USED'`,
    [coupon_id]
  );
  return rows[0].c;
};

exports.countUserUsage = async (coupon_id, user_id) => {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM coupon_usages WHERE coupon_id = ? AND user_id = ? AND status = 'USED'`,
    [coupon_id, user_id]
  );
  return rows[0].c;
},

  exports.recordUsage = async ({ coupon_id, user_id, order_id = null, order_item_id = null }) => {
    const [result] = await pool.query(
      `INSERT INTO coupon_usages (coupon_id, user_id, order_id, order_item_id, status, used_at)
       VALUES (?, ?, ?, ?, 'USED', CURRENT_TIMESTAMP())`,
      [coupon_id, user_id, order_id, order_item_id]
    );
    return result.insertId;
  };

exports.revertUsage = async (usage_id) => {
  const [result] = await pool.query(
    `UPDATE coupon_usages SET status = 'REVERTED', reverted_at = CURRENT_TIMESTAMP() WHERE usage_id = ?`,
    [usage_id]
  );
  return result.affectedRows;
};

exports.getCouponById = async (id) => {
  const [rows] = await pool.query(`SELECT * FROM coupons WHERE id = ?`, [id]);
  return rows[0];
};

exports.getCouponByCode = async (code) => {
  const [rows] = await pool.query(`SELECT * FROM coupons WHERE code = ? LIMIT 1`, [code]);
  return rows[0];
};

exports.updateCoupon = async (id, couponData, products = [], categories = [], variants = []) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const fields = [];
    const values = [];

    // Only include fields that exist in the coupons table
    for (const key of Object.keys(couponData)) {
      if (['code', 'description', 'discount_type', 'discount_value', 'usage_limit', 'per_user_limit', 'min_order_amount', 'min_quantity', 'applies_to', 'priority', 'start_date', 'expiry_date', 'is_active'].includes(key)) {
        fields.push(`${key} = ?`);
        values.push(couponData[key]);
      }
    }

    if (fields.length > 0) {
      values.push(id);

      // 🔴 LOG WHICH FIELDS ARE BEING UPDATED
      logger.info(`[CouponModel] Updating ${fields.length} fields for coupon ${id}`);
      logger.info(`[CouponModel] Fields being updated:`, fields.join(', '));

      // Log each field value
      logger.info(`[CouponModel] Field values (before adding ID):`, {
        code: couponData.code,
        description: couponData.description,
        discount_type: couponData.discount_type,
        discount_value: couponData.discount_value,
        usage_limit: couponData.usage_limit,
        per_user_limit: couponData.per_user_limit,
        min_order_amount: couponData.min_order_amount,
        min_quantity: couponData.min_quantity,
        applies_to: couponData.applies_to,
        priority: couponData.priority,
        start_date: couponData.start_date,
        expiry_date: couponData.expiry_date,
        is_active: couponData.is_active,
      });

      const updateQuery = `UPDATE coupons SET ${fields.join(", ")} WHERE id = ?`;
      logger.info(`[CouponModel] SQL Query: ${updateQuery}`);
      logger.info(`[CouponModel] Query values (including ID):`, values);

      const updateResult = await conn.query(updateQuery, values);
      logger.info(`[CouponModel] Update result:`, {
        affectedRows: updateResult[0]?.affectedRows || 0,
        changedRows: updateResult[0]?.changedRows || 0,
      });
    } else {
      logger.info(`[CouponModel] ⚠️  No fields to update for coupon ${id}`);
    }

    // 🔴 CRITICAL FIX: ALWAYS delete ALL mappings first (even if empty)
    // This prevents old mappings from interfering when coupon level is changed
    logger.info(`[CouponModel] Clearing all mappings for coupon ${id} before update`);
    await conn.query(`DELETE FROM coupon_products WHERE coupon_id = ?`, [id]);
    await conn.query(`DELETE FROM coupon_categories WHERE coupon_id = ?`, [id]);
    await conn.query(`DELETE FROM coupon_variants WHERE coupon_id = ?`, [id]);

    // Now insert ONLY the new mappings based on current applies_to level
    const newAppliesTo = couponData.applies_to || 'order';
    logger.info(`[CouponModel] Coupon ${id} updated to applies_to: ${newAppliesTo}`);

    // Update product mappings (only if provided)
    if (products && products.length > 0) {
      const prodValues = products.map((p) => [id, p]);
      await conn.query(`INSERT INTO coupon_products (coupon_id, product_id) VALUES ?`, [prodValues]);
      logger.info(`[CouponModel] Added ${products.length} product mappings`);
    }

    // Update category mappings (only if provided)
    if (categories && categories.length > 0) {
      const catValues = categories.map((c) => [id, c]);
      await conn.query(`INSERT INTO coupon_categories (coupon_id, category_id) VALUES ?`, [catValues]);
      logger.info(`[CouponModel] Added ${categories.length} category mappings`);
    }

    // Update variant mappings (only if provided)
    if (variants && variants.length > 0) {
      const varValues = variants.map((v) => [id, v]);
      await conn.query(`INSERT INTO coupon_variants (coupon_id, variant_id) VALUES ?`, [varValues]);
      logger.info(`[CouponModel] Added ${variants.length} variant mappings`);
    }

    await conn.commit();
    logger.info(`[CouponModel] ✅ Transaction committed for coupon ${id}\n`);
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};


exports.setCouponActiveState = async (id, state) => {
  const [result] = await pool.query(`UPDATE coupons SET is_active = ? WHERE id = ?`, [state, id]);
  return result.affectedRows > 0;
};

exports.deleteCoupon = async (id) => {
  const [result] = await pool.query(`UPDATE coupons SET is_active = FALSE WHERE id = ?`, [id]);
  return result.affectedRows > 0;
};

exports.restoreCoupon = async (id) => {
  const [result] = await pool.query(`UPDATE coupons SET is_active = TRUE WHERE id = ?`, [id]);
  return result.affectedRows > 0;
};

exports.getNotActiveCoupons = async () => {
  const [rows] = await pool.query(`SELECT * FROM coupons WHERE is_active = FALSE ORDER BY created_at DESC`);
  return rows;
};

/// ---------------------
// Coupon Usage Tracking
// ---------------------

/**
 * ✅ Record a coupon usage safely (insert or revive reverted usage)
 * Prevents duplicate usage with the UNIQUE constraint
 */
exports.recordCouponUsage = async (couponId, userId, orderId, orderItemId = null) => {
  const usedAt = new Date();

  const [result] = await pool.query(
    `
    INSERT INTO coupon_usages (coupon_id, user_id, order_id, order_item_id, used_at, status)
    VALUES (?, ?, ?, ?, ?, 'USED')
    ON DUPLICATE KEY UPDATE
      status = 'USED',
      reverted_at = NULL,
      used_at = VALUES(used_at)
    `,
    [couponId, userId, orderId, orderItemId, usedAt]
  );

  return result.insertId;
};

/**
 * ✅ Revert usage (used for cancel / return / failed order)
 */
exports.revertCouponUsage = async (couponId, orderId, orderItemId = null) => {
  const revertedAt = new Date();
  await pool.query(
    `
    UPDATE coupon_usages
    SET status = 'REVERTED', reverted_at = ?
    WHERE coupon_id = ? AND order_id = ? 
      AND (order_item_id = ? OR (? IS NULL AND order_item_id IS NULL))
    `,
    [revertedAt, couponId, orderId, orderItemId, orderItemId]
  );
};

/**
 * ✅ Check if user already used this coupon
 */
exports.isCouponUsedByUser = async (couponId, userId) => {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM coupon_usages
     WHERE coupon_id = ? AND user_id = ? AND status = 'USED'`,
    [couponId, userId]
  );
  return rows[0].cnt > 0;
};

/**
 * ✅ Count how many times this coupon was used globally
 */
exports.getTotalUsageCount = async (couponId) => {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM coupon_usages
     WHERE coupon_id = ? AND status = 'USED'`,
    [couponId]
  );
  return rows[0].cnt;
};

/**
 * ✅ Count how many times this coupon was used by a specific user
 */
exports.getUserUsageCount = async (couponId, userId) => {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM coupon_usages
     WHERE coupon_id = ? AND user_id = ? AND status = 'USED'`,
    [couponId, userId]
  );
  return rows[0].cnt;
};

/**
 * ✅ Get all usage records (for admin analytics or audit)
 */
exports.getCouponUsageHistory = async (couponId) => {
  const [rows] = await pool.query(
    `SELECT cu.*, u.name AS user_name, o.order_status
     FROM coupon_usages cu
     LEFT JOIN users u ON cu.user_id = u.id
     LEFT JOIN orders o ON cu.order_id = o.id
     WHERE cu.coupon_id = ?
     ORDER BY cu.used_at DESC`,
    [couponId]
  );
  return rows;
};

/**
 * ✅ Revert all coupons used in an order (item-level + order-level)
 */
exports.revertCouponsByOrder = async (orderId) => {
  await pool.query(
    `UPDATE coupon_usages
     SET status = 'REVERTED', reverted_at = NOW()
     WHERE order_id = ? AND status = 'USED'`,
    [orderId]
  );
};

exports.getCouponVariants = async (coupon_id) => {
  const [rows] = await pool.query(
    `SELECT variant_id FROM coupon_variants WHERE coupon_id = ?`,
    [coupon_id]
  );
  return rows.map(r => r.variant_id);
},

  /**
   * ✅ Bulk check if a user can use multiple coupons (item-level + order-level)
   * Returns map: { couponId: true/false }
   */
  exports.checkUserCouponEligibility = async (userId, couponIds) => {
    if (!couponIds.length) return {};

    const [rows] = await pool.query(
      `SELECT coupon_id, COUNT(*) AS used
     FROM coupon_usages
     WHERE user_id = ? AND coupon_id IN (?) AND status = 'USED'
     GROUP BY coupon_id`,
      [userId, couponIds]
    );

    const usageMap = {};
    couponIds.forEach(id => usageMap[id] = 0);
    rows.forEach(r => usageMap[r.coupon_id] = r.used);

    return usageMap; // {couponId: usedCount}
  };


// const pool = require("../config/db");

// // ---------------------
// // CREATE COUPON
// // ---------------------
// exports.createCoupon = async (couponData, products = [], categories = [], variants = []) => {
//   const conn = await pool.getConnection();
//   try {
//     await conn.beginTransaction();

//     const [result] = await conn.query(
//       `INSERT INTO coupons
//       (code, description, discount_type, discount_value, usage_limit, per_user_limit,
//        min_order_amount, min_quantity, applies_to, priority, start_date, expiry_date, is_active)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         couponData.code,
//         couponData.description || null,
//         couponData.discount_type,
//         couponData.discount_value,
//         couponData.usage_limit ?? 0,
//         couponData.per_user_limit ?? 1,
//         couponData.min_order_amount ?? 0,
//         couponData.min_quantity ?? null,
//         couponData.applies_to || "order",
//         couponData.priority ?? 1,
//         couponData.start_date || new Date(),
//         couponData.expiry_date,
//         couponData.is_active ?? true,
//       ]
//     );

//     const couponId = result.insertId;

//     if (products.length > 0) {
//       const prodValues = products.map((p) => [couponId, p]);
//       await conn.query(`INSERT INTO coupon_products (coupon_id, product_id) VALUES ?`, [prodValues]);
//     }

//     if (categories.length > 0) {
//       const catValues = categories.map((c) => [couponId, c]);
//       await conn.query(`INSERT INTO coupon_categories (coupon_id, category_id) VALUES ?`, [catValues]);
//     }

//     if (variants.length > 0) {
//       const varValues = variants.map((v) => [couponId, v]);
//       await conn.query(`INSERT INTO coupon_variants (coupon_id, variant_id) VALUES ?`, [varValues]);
//     }

//     await conn.commit();
//     return couponId;
//   } catch (err) {
//     await conn.rollback();
//     throw err;
//   } finally {
//     conn.release();
//   }
// };

// // ---------------------
// // GET COUPONS
// // ---------------------
// exports.getCoupons = async () => {
//   const [rows] = await pool.query(`SELECT * FROM coupons ORDER BY created_at DESC`);
//   return rows;
// };

// exports.getCouponById = async (id) => {
//   const [rows] = await pool.query(`SELECT * FROM coupons WHERE id = ? AND is_active = TRUE`, [id]);
//   return rows[0];
// };

// exports.getCouponByCode = async (code) => {
//   const [rows] = await pool.query(`SELECT * FROM coupons WHERE code = ? LIMIT 1`, [code]);
//   return rows[0];
// };

// // ---------------------
// // UPDATE COUPON
// // ---------------------
// exports.updateCoupon = async (id, couponData, products = [], categories = [], variants = []) => {
//   const conn = await pool.getConnection();
//   try {
//     await conn.beginTransaction();

//     const fields = [];
//     const values = [];

//     for (const key of Object.keys(couponData)) {
//       fields.push(`${key} = ?`);
//       values.push(couponData[key]);
//     }

//     if (fields.length > 0) {
//       values.push(id);
//       await conn.query(`UPDATE coupons SET ${fields.join(", ")} WHERE id = ?`, values);
//     }

//     if (products.length > 0) {
//       await conn.query(`DELETE FROM coupon_products WHERE coupon_id = ?`, [id]);
//       const prodValues = products.map((p) => [id, p]);
//       await conn.query(`INSERT INTO coupon_products (coupon_id, product_id) VALUES ?`, [prodValues]);
//     }

//     if (categories.length > 0) {
//       await conn.query(`DELETE FROM coupon_categories WHERE coupon_id = ?`, [id]);
//       const catValues = categories.map((c) => [id, c]);
//       await conn.query(`INSERT INTO coupon_categories (coupon_id, category_id) VALUES ?`, [catValues]);
//     }

//     if (variants.length > 0) {
//       await conn.query(`DELETE FROM coupon_variants WHERE coupon_id = ?`, [id]);
//       const varValues = variants.map((v) => [id, v]);
//       await conn.query(`INSERT INTO coupon_variants (coupon_id, variant_id) VALUES ?`, [varValues]);
//     }

//     await conn.commit();
//     return true;
//   } catch (err) {
//     await conn.rollback();
//     throw err;
//   } finally {
//     conn.release();
//   }
// };

// // ---------------------
// // DEACTIVATE / ACTIVATE / RESTORE
// // ---------------------
// exports.setCouponActiveState = async (id, state) => {
//   const [result] = await pool.query(`UPDATE coupons SET is_active = ? WHERE id = ?`, [state, id]);
//   return result.affectedRows > 0;
// };

// exports.deleteCoupon = async (id) => {
//   const [result] = await pool.query(`UPDATE coupons SET is_active = FALSE WHERE id = ?`, [id]);
//   return result.affectedRows > 0;
// };

// exports.restoreCoupon = async (id) => {
//   const [result] = await pool.query(`UPDATE coupons SET is_active = TRUE WHERE id = ?`, [id]);
//   return result.affectedRows > 0;
// };

// exports.getNotActiveCoupons = async () => {
//   const [rows] = await pool.query(`SELECT * FROM coupons WHERE is_active = FALSE ORDER BY created_at DESC`);
//   return rows;
// };

// // ---------------------
// // USAGE TRACKING
// // ---------------------
// exports.recordCouponUsage = async (couponId, userId, orderId) => {
//   const [result] = await pool.query(
//     `INSERT INTO coupon_usage (coupon_id, user_id, order_id) VALUES (?, ?, ?)`,
//     [couponId, userId, orderId]
//   );
//   return result.insertId;
// };

// exports.getTotalUsageCount = async (couponId) => {
//   const [rows] = await pool.query(`SELECT COUNT(*) AS cnt FROM coupon_usage WHERE coupon_id = ?`, [couponId]);
//   return rows[0].cnt;
// };

// exports.getUserUsageCount = async (couponId, userId) => {
//   const [rows] = await pool.query(
//     `SELECT COUNT(*) AS cnt FROM coupon_usage WHERE coupon_id = ? AND user_id = ?`,
//     [couponId, userId]
//   );
//   return rows[0].cnt;
// };

// // ---------------------
// // PRODUCT / CATEGORY / VARIANT MAPPINGS
// // ---------------------
// exports.getCouponProducts = async (couponId) => {
//   const [rows] = await pool.query(`SELECT product_id FROM coupon_products WHERE coupon_id = ?`, [couponId]);
//   return rows.map((r) => r.product_id);
// };

// exports.getCouponCategories = async (couponId) => {
//   const [rows] = await pool.query(`SELECT category_id FROM coupon_categories WHERE coupon_id = ?`, [couponId]);
//   return rows.map((r) => r.category_id);
// };

// exports.getCouponVariants = async (couponId) => {
//   const [rows] = await pool.query(`SELECT variant_id FROM coupon_variants WHERE coupon_id = ?`, [couponId]);
//   return rows.map((r) => r.variant_id);
// };

// // ---------------------
// // COUPONS FOR PRODUCT / CATEGORY
// // ---------------------
// exports.getCouponsForProduct = async (productId) => {
//   const [rows] = await pool.query(
//     `SELECT c.*
//      FROM coupons c
//      LEFT JOIN coupon_products cp ON c.id = cp.coupon_id
//      LEFT JOIN coupon_categories cc ON c.id = cc.coupon_id
//      LEFT JOIN products p ON p.id = ?
//      WHERE c.is_active = TRUE
//        AND (cp.product_id = ? OR cc.category_id = p.category_id)
//        AND c.start_date <= NOW() AND c.expiry_date >= NOW()
//      GROUP BY c.id`,
//     [productId, productId]
//   );
//   return rows.map((c) => ({
//     code: c.code,
//     description: c.description,
//     discount_type: c.discount_type,
//     discount_value: Number(c.discount_value),
//   }));
// };

// exports.getCouponsForCategory = async (categoryId) => {
//   const [rows] = await pool.query(
//     `SELECT DISTINCT c.*
//      FROM coupons c
//      LEFT JOIN coupon_categories cc ON c.id = cc.coupon_id
//      LEFT JOIN coupon_products cp ON c.id = cp.coupon_id
//      LEFT JOIN products p ON p.category_id = ?
//      WHERE c.is_active = TRUE
//        AND (cc.category_id = ? OR cp.product_id = p.id)
//        AND c.start_date <= NOW() AND c.expiry_date >= NOW()`,
//     [categoryId, categoryId]
//   );
//   return rows.map((c) => ({
//     code: c.code,
//     description: c.description,
//     discount_type: c.discount_type,
//     discount_value: Number(c.discount_value),
//   }));
// };
