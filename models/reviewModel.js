const logger = require("../utils/logger");
const pool = require("../config/db");

const Review = {
  // ✅ Create user review
  async createUserReview({ user_id, product_id, order_id, order_item_id, rating, comment }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [items] = await conn.query(
        `
        SELECT 
          oi.order_item_id, 
          oi.product_id,
          o.order_id,
          o.user_id,
          o.order_status
        FROM order_items oi
        JOIN orders o ON o.order_id = oi.order_id
        WHERE oi.order_item_id = ? AND o.user_id = ?
        `,
        [order_item_id, user_id]
      );

      if (!items.length) throw new Error("Invalid order item or unauthorized access.");

      const orderItem = items[0];
      if (!["DELIVERED", "COMPLETED"].includes(orderItem.order_status)) {
        throw new Error("You can only review delivered products.");
      }

      const [existing] = await conn.query(
        `SELECT id FROM reviews WHERE user_id = ? AND order_item_id = ? AND deleted_at IS NULL AND status != 'REJECTED'`,
        [user_id, order_item_id]
      );
      if (existing.length) throw new Error("You have already reviewed this product.");

      const [result] = await conn.query(
        `
        INSERT INTO reviews (
          user_id, product_id, order_id, order_item_id, rating, comment,
          is_verified_purchase, created_by_admin, status
        ) VALUES (?, ?, ?, ?, ?, ?, TRUE, FALSE, 'APPROVED')
        `,
        [user_id, product_id, order_id, order_item_id, rating, comment]
      );

      await conn.query(
        `INSERT INTO review_audit_logs (review_id, actor_type, actor_id, action)
         VALUES (?, 'USER', ?, 'CREATED')`,
        [result.insertId, user_id]
      );

      await conn.commit();
      return result.insertId;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  // ✅ Update user review
  async updateUserReview({ user_id, review_id, rating, comment }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [exists] = await conn.query(
        `SELECT id FROM reviews WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [review_id, user_id]
      );

      if (!exists.length) throw new Error("Review not found or unauthorized.");

      await conn.query(
        `
        UPDATE reviews 
        SET rating = ?, comment = ?, updated_at = NOW() 
        WHERE id = ? AND user_id = ?
        `,
        [rating, comment, review_id, user_id]
      );

      await conn.query(
        `
        INSERT INTO review_audit_logs (review_id, actor_type, actor_id, action)
        VALUES (?, 'USER', ?, 'UPDATED')
        `,
        [review_id, user_id]
      );

      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  // ✅ Delete user review
  async deleteUserReview(user_id, review_id) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ✅ Check if the review exists and belongs to the user
    const [exists] = await conn.query(
      `SELECT id FROM reviews WHERE id = ? AND user_id = ?`,
      [review_id, user_id]
    );

    if (!exists.length) {
      throw new Error("Review not found or unauthorized.");
    }

    // ✅ Insert audit log before deleting
    await conn.query(
      `INSERT INTO review_audit_logs (review_id, actor_type, actor_id, action)
       VALUES (?, 'USER', ?, 'DELETED')`,
      [review_id, user_id]
    );

    // ✅ Permanently delete the review
    await conn.query(
      `DELETE FROM reviews WHERE id = ? AND user_id = ?`,
      [review_id, user_id]
    );

    // (Optional) Clean up related audit logs if you don’t want orphaned entries
    await conn.query(`DELETE FROM review_audit_logs WHERE review_id = ?`, [review_id]);

    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
},

  async deleteAdminReviewSoftly(admin_id, review_id) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [exists] = await conn.query(
        `SELECT id FROM reviews WHERE id = ? AND deleted_at IS NULL`,
        [review_id]
      );

      if (!exists.length) throw new Error("Review not found or already deleted.");

      await conn.query(`UPDATE reviews SET deleted_at = NOW() WHERE id = ?`, [
        review_id,
      ]);

      await conn.query(
        `INSERT INTO review_audit_logs (review_id, actor_type, actor_id, action)
         VALUES (?, 'ADMIN', ?, 'DELETED')`,
        [review_id, admin_id]
      );

      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

   async deleteUserReviewSoftly(user_id, review_id) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [exists] = await conn.query(
        `SELECT id FROM reviews WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [review_id, user_id]
      );

      if (!exists.length) throw new Error("Review not found or unauthorized.");

      await conn.query(`UPDATE reviews SET deleted_at = NOW() WHERE id = ? AND user_id = ?`, [
        review_id,
        user_id,
      ]);

      await conn.query(
        `INSERT INTO review_audit_logs (review_id, actor_type, actor_id, action)
         VALUES (?, 'USER', ?, 'DELETED')`,
        [review_id, user_id]
      );

      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    } 
  },

async deleteReviewPermanentlyById(review_id) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Permanently remove the review
    const [result] = await conn.query(`DELETE FROM reviews WHERE id = ?`, [review_id]);

    // Optional: remove related audit logs
    await conn.query(`DELETE FROM review_audit_logs WHERE review_id = ?`, [review_id]);

    await conn.commit();
    return result.affectedRows > 0; // returns true if a row was deleted
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
},
  // ✅ Create admin (fake) review
async createAdminReview({
  admin_id,
  product_id,
  rating,
  comment,
  is_verified_purchase = false,
}) {
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.query(
      `
      INSERT INTO reviews (
        user_id, admin_id, product_id, rating, comment,
        is_verified_purchase, created_by_admin, status
      )
      VALUES (NULL, ?, ?, ?, ?, ?, 1, 'APPROVED')
      `,
      [admin_id, product_id, rating, comment, is_verified_purchase]
    );

    await conn.query(
      `
      INSERT INTO review_audit_logs (review_id, actor_type, actor_id, action)
      VALUES (?, 'ADMIN', ?, 'CREATED_FAKE')
      `,
      [result.insertId, admin_id]
    );

    return result.insertId;
  } finally {
    conn.release();
  }
},

  // ✅ Verify review by admin
  async verifyReview(admin_id, review_id) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [exists] = await conn.query(`SELECT id FROM reviews WHERE id = ?`, [review_id]);
      if (!exists.length) throw new Error("Review not found.");

      await conn.query(
        `UPDATE reviews SET verified_by_admin = TRUE, status = 'APPROVED' WHERE id = ?`,
        [review_id]
      );

      await conn.query(
        `INSERT INTO review_audit_logs (review_id, actor_type, actor_id, action)
         VALUES (?, 'ADMIN', ?, 'VERIFIED')`,
        [review_id, admin_id]
      );

      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  // ✅ Reject review by admin
  async rejectReview(admin_id, review_id) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [exists] = await conn.query(`SELECT id FROM reviews WHERE id = ?`, [review_id]);
      if (!exists.length) throw new Error("Review not found.");

      await conn.query(
        `UPDATE reviews SET status = 'REJECTED', verified_by_admin = FALSE WHERE id = ?`,
        [review_id]
      );

      await conn.query(
        `
        INSERT INTO review_audit_logs (review_id, actor_type, actor_id, action)
        VALUES (?, 'ADMIN', ?, 'REJECTED')
        `,
        [review_id, admin_id]
      );

      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  // ✅ Fetch product reviews (public)
  async getProductReviews(product_id) {
    const [rows] = await pool.query(
      `
      SELECT 
        r.id,
        r.user_id,
        r.admin_id,
        r.rating,
        r.comment,
        r.is_verified_purchase,
        r.created_by_admin,
        r.verified_by_admin,
        r.created_at,
        CASE WHEN r.user_id IS NOT NULL THEN 'USER' ELSE 'ADMIN' END AS review_source
      FROM reviews r
      WHERE r.product_id = ? 
        AND r.status = 'APPROVED'
        AND r.deleted_at IS NULL
      ORDER BY r.created_at DESC
      `,
      [product_id]
    );
    return rows;
  }, 

  // ✅ Fetch product review by ID
  async getReviewById(review_id) {
    const [rows] = await pool.query(
      `SELECT * FROM reviews WHERE id = ? AND status = 'APPROVED' AND deleted_at IS NULL`,
      [review_id]
    );
    return rows[0];
  },

  async getUserReviews(user_id) {
    const [rows] = await pool.query(
      `SELECT 
        r.*,
        p.name as product_name,
        p.description as product_description,
        pm.media_url as product_image,
        pm.media_type
      FROM reviews r
      LEFT JOIN products p ON r.product_id = p.id
      LEFT JOIN product_media pm ON p.id = pm.product_id AND pm.sort_order = 1
      WHERE r.user_id = ? AND r.status = 'APPROVED' AND r.deleted_at IS NULL
      ORDER BY r.created_at DESC`,
      [user_id]
    );
    return rows;
  },

  async getAdminReviews(admin_id) {
    const [rows] = await pool.query(
      `SELECT * FROM reviews WHERE admin_id = ? AND status = 'APPROVED' AND deleted_at IS NULL`,
      [admin_id]
    );
    return rows;
  },

  async getAllPendingReviews() {
    const [rows] = await pool.query(
      `SELECT * FROM reviews WHERE status = 'PENDING' AND deleted_at IS NULL`
    );
    return rows;
  },

  async getAllRejectedReviews() {
    const [rows] = await pool.query(
      `SELECT * FROM reviews WHERE status = 'REJECTED' AND deleted_at IS NULL`
    );
    return rows;
  },

async getAllApprovedAndVerifiedReviews() {
  const [rows] = await pool.query(
    `SELECT 
        id,
        user_id,
        admin_id,
        product_id,
        order_id,
        order_item_id,
        rating,
        comment,
        is_verified_purchase,
        created_by_admin,
        verified_by_admin,
        status,
        created_at,
        updated_at
     FROM reviews
     WHERE status = 'APPROVED'
       AND verified_by_admin = 1
       AND deleted_at IS NULL
     ORDER BY created_at DESC`
  );

  return rows;
},


// ✅ Restore a soft-deleted review
async restoreReview(review_id) {
  const conn = await pool.getConnection();
  try {
    const [exists] = await conn.query(
      `SELECT id FROM reviews WHERE id = ? AND deleted_at IS NOT NULL`,
      [review_id]
    );

    if (!exists.length) throw new Error("Review not found or not deleted");

    await conn.query(
      `UPDATE reviews SET deleted_at = NULL WHERE id = ?`,
      [review_id]
    );

    return true;
  } finally {
    conn.release();
  }
},



  async getSoftlyDeletedReviews() {
    const [rows] = await pool.query(
      `SELECT * FROM reviews WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
    );
    return rows;
  },

  async getReviewAuditLogs(review_id) {
    const [rows] = await pool.query(
      `SELECT * FROM review_audit_logs WHERE review_id = ? ORDER BY created_at DESC`,
      [review_id]
    );
    return rows;
  },

  async getReviewAuditLogsByActor(actor_type, actor_id) {
    const [rows] = await pool.query(
      `SELECT * FROM review_audit_logs WHERE actor_type = ? AND actor_id = ? ORDER BY created_at DESC`,
      [actor_type, actor_id]
    );
    return rows;
  },

  async getReviewAuditLogsByAction(action) {
    const [rows] = await pool.query(
      `SELECT * FROM review_audit_logs WHERE action = ? ORDER BY created_at DESC`,
      [action]
    );
    return rows;
  },

  async getReviewAuditLogsByReviewId(review_id) {
    const [rows] = await pool.query(
      `SELECT * FROM review_audit_logs WHERE review_id = ? ORDER BY created_at DESC`,
      [review_id]
    );
    return rows;
  },

  async updateProductAvgRating(product_id) {
  try {
    // 1️⃣ Calculate average rating for all non-deleted & non-rejected reviews
    const [rows] = await pool.query(
      `SELECT AVG(rating) AS avg_rating
       FROM reviews
       WHERE product_id = ?
         AND (deleted_at IS NULL OR deleted_at = '')
         AND status != 'REJECTED'`,
      [product_id]
    );

    const avgRating = rows[0]?.avg_rating || 0;

    // 2️⃣ Update the products table
    await pool.query(
      `UPDATE products SET avg_rating = ? WHERE id = ?`,
      [avgRating.toFixed(2), product_id]
    );

    return avgRating.toFixed(2);
  } catch (err) {
    logger.error("❌ Error updating product avg_rating:", err);
    throw err;
  }
},

async getReviewsByProductId(product_id) {
  const [rows] = await pool.query(
    `SELECT 
        id,
        product_id,
        rating,
        comment,
        is_verified_purchase,
        verified_by_admin,
        status,
        created_at,
        updated_at
     FROM reviews
     WHERE product_id = ?
       AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [product_id]
  );

  return rows;
},

async getAllAdminReviews(limit = 200, offset = 0, search = "", productId = "all") {
  let query = `
     SELECT 
        id,
        user_id,
        admin_id,
        product_id,
        rating,
        comment,
        is_verified_purchase,
        created_by_admin,
        verified_by_admin,
        status,
        created_at,
        updated_at
     FROM reviews
     WHERE deleted_at IS NULL
  `;
  const params = [];
  
  if (productId !== "all" && productId !== "") {
    query += ` AND product_id = ?`;
    params.push(Number(productId));
  }
  
  if (search) {
    query += ` AND comment LIKE ?`;
    params.push(`%${search}%`);
  }
  
  const countQuery = query.replace(/SELECT[\s\S]*?FROM/, "SELECT COUNT(*) as total FROM");
  logger.info(`[reviewModel] countQuery: ${countQuery}`, params);
  const [countResult] = await pool.query(countQuery, params);
  
  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));
  
  logger.info(`[reviewModel] dataQuery: ${query}`, params);
  const [rows] = await pool.query(query, params);
  logger.info(`[reviewModel] results: rows=${rows.length}, total=${countResult[0].total}`);
  return { reviews: rows, total: Number(countResult[0].total) };
},

};

module.exports = Review;
