const pool = require("../config/db");

// ================== ADMIN MODEL ==================

// ✅ Create Admin / Super Admin
exports.createAdmin = async ({ name, email, phone_number, role, password_hash }) => {
  try {
    const [result] = await pool.query(
      `INSERT INTO admin (name, email, phone_number, role, password, status) 
       VALUES (?, ?, ?, ?, ?, 'active')`,
      [name, email.toLowerCase(), phone_number, role, password_hash]
    );
    return result.insertId;
  } catch (err) {
    throw new Error("Error creating admin: " + err.message);
  }
};

// ✅ Find admin by email
exports.findByEmail = async (email) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM admin WHERE email = ? LIMIT 1",
      [email.toLowerCase()]
    );
    return rows[0] || null;
  } catch (err) {
    throw new Error("Error finding admin by email: " + err.message);
  }
};

// ✅ Get admin by ID
exports.getAdminById = async (id) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM admin WHERE id = ? LIMIT 1",
      [id]
    );
    return rows[0] || null;
  } catch (err) {
    throw new Error("Error fetching admin by ID: " + err.message);
  }
};

// ✅ Update admin details
// ✅ Update admin details
exports.updateAdmin = async (id, adminData) => {
  try {
    if (!adminData || Object.keys(adminData).length === 0) {
      throw new Error("No fields to update");
    }

    const fields = Object.keys(adminData)
      .map(key => `${key} = ?`)
      .join(", ");

    const values = [...Object.values(adminData), id];

    const sql = `UPDATE admin SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    const [result] = await pool.query(sql, values);
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error updating admin: " + err.message);
  }
};

// ✅ Update admin status
exports.updateAdminStatus = async (id, status) => {
  try {
    const [result] = await pool.query(
      "UPDATE admin SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [status, id]
    );
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error updating admin status: " + err.message);
  }
};

// ✅ Update last login timestamp
exports.updateLastLogin = async (id) => {
  try {
    const [result] = await pool.query(
      "UPDATE admin SET last_login = CURRENT_TIMESTAMP WHERE id = ?",
      [id]
    );
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error updating last login: " + err.message);
  }
};

// ✅ Store refresh token
exports.storeRefreshToken = async (adminId, refreshToken, expiresAt) => {
  try {
    const [existing] = await pool.query(
      "SELECT id FROM admin_refresh_tokens WHERE admin_id = ?",
      [adminId]
    );

    if (existing.length > 0) {
      await pool.query(
        "UPDATE admin_refresh_tokens SET token = ?, expires_at = ?, created_at = CURRENT_TIMESTAMP WHERE admin_id = ?",
        [refreshToken, expiresAt, adminId]
      );
    } else {
      await pool.query(
        "INSERT INTO admin_refresh_tokens (admin_id, token, expires_at) VALUES (?, ?, ?)",
        [adminId, refreshToken, expiresAt]
      );
    }
    return true;
  } catch (err) {
    throw new Error("Error storing refresh token: " + err.message);
  }
};


// ✅ Find refresh token
exports.findRefreshToken = async (adminId) => {
  try {
    const [rows] = await pool.query(
      "SELECT token FROM admin_refresh_tokens WHERE admin_id = ? AND expires_at > NOW() LIMIT 1",
      [adminId]
    );
    return rows[0]?.token || null;
  } catch (err) {
    throw new Error("Error finding refresh token: " + err.message);
  }
};

// ✅ Delete refresh token
exports.deleteRefreshToken = async (adminId) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM admin_refresh_tokens WHERE admin_id = ?",
      [adminId]
    );
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error deleting refresh token: " + err.message);
  }
};

// ✅ Get all admins
exports.getAllAdmins = async () => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, phone_number, role, status, created_at FROM admin ORDER BY created_at DESC"
    );
    return rows;
  } catch (err) {
    throw new Error("Error fetching all admins: " + err.message);
  }
};

// ✅ Delete admin
exports.deleteAdmin = async (id) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM admin WHERE id = ?",
      [id]
    );

    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error deleting admin: " + err.message);
  }
};


// ============================================================
// ✅ Store OTP (HASHED)
// ============================================================

exports.storeOTP = async (adminId, hashedOtp, expiresAt) => {
  const [existing] = await pool.query(
    "SELECT id FROM admin_otp WHERE admin_id = ?",
    [adminId]
  );

  if (existing.length > 0) {
    await pool.query(
      `UPDATE admin_otp 
       SET otp = ?, expires_at = ?, is_verified = 0, created_at = CURRENT_TIMESTAMP 
       WHERE admin_id = ?`,
      [hashedOtp, expiresAt, adminId]
    );
  } else {
    await pool.query(
      `INSERT INTO admin_otp (admin_id, otp, expires_at) 
       VALUES (?, ?, ?)`,
      [adminId, hashedOtp, expiresAt]
    );
  }

  return true;
};

// ============================================================
// ✅ Get OTP (NO COMPARISON HERE)
// ============================================================

exports.getOTP = async (adminId) => {
  const [rows] = await pool.query(
    `SELECT otp, expires_at 
     FROM admin_otp 
     WHERE admin_id = ? 
       AND expires_at > NOW() 
       AND is_verified = 0 
     LIMIT 1`,
    [adminId]
  );

  return rows[0] || null;
};

// ============================================================
// ✅ Mark OTP Verified
// ============================================================

exports.verifyOTP = async (adminId) => {
  const [result] = await pool.query(
    `UPDATE admin_otp 
     SET is_verified = 1, verified_at = CURRENT_TIMESTAMP 
     WHERE admin_id = ? AND is_verified = 0`,
    [adminId]
  );

  return result.affectedRows > 0;
};

// ============================================================
// ✅ Delete OTP
// ============================================================

exports.deleteOTP = async (adminId) => {
  const [result] = await pool.query(
    "DELETE FROM admin_otp WHERE admin_id = ?",
    [adminId]
  );

  return result.affectedRows > 0;
};


exports.getOTPWithLock = async (adminId) => {
  const [rows] = await pool.query(
    `SELECT otp, attempts, locked_until
     FROM admin_otp
     WHERE admin_id = ?
       AND expires_at > NOW()
       AND is_verified = 0
     LIMIT 1`,
    [adminId]
  );
  return rows[0] || null;
};

exports.incrementOTPAttempts = async (adminId, attempts) => {
  await pool.query(
    `UPDATE admin_otp SET attempts = ? WHERE admin_id = ?`,
    [attempts, adminId]
  );
};

exports.lockOTP = async (adminId, attempts, lockedUntil) => {
  await pool.query(
    `UPDATE admin_otp 
     SET attempts = ?, locked_until = ?
     WHERE admin_id = ?`,
    [attempts, lockedUntil, adminId]
  );
};

exports.clearOTP = async (adminId) => {
  await pool.query(
    `DELETE FROM admin_otp WHERE admin_id = ?`,
    [adminId]
  );
};

exports.createAdminUpdateOtp = async ({
  target_admin_id,
  otp,
  payload,
  expires_at
}) => {
  const [result] = await pool.query(
    `
    INSERT INTO admin_update_otp
    (target_admin_id, otp, payload, expires_at)
    VALUES (?, ?, ?, ?)
    `,
    [target_admin_id, otp, payload, expires_at]
  );

  return result.insertId;
};


exports.getAdminUpdateOtp = async (targetAdminId) => {
  const [rows] = await pool.query(
    `
    SELECT *
    FROM admin_update_otp
    WHERE target_admin_id = ?
      AND verified_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [targetAdminId]
  );

  return rows[0];
};


exports.incrementAdminUpdateOtpAttempts = async (id, attempts) => {
  await pool.query(
    `
    UPDATE admin_update_otp
    SET attempts = ?
    WHERE id = ?
    `,
    [attempts, id]
  );
};


exports.lockAdminUpdateOtp = async (id, attempts, lockedUntil) => {
  await pool.query(
    `
    UPDATE admin_update_otp
    SET attempts = ?, locked_until = ?
    WHERE id = ?
    `,
    [attempts, lockedUntil, id]
  );
};


exports.resetAdminUpdateOtp = async (id, otp, expires_at) => {
  await pool.query(
    `
    UPDATE admin_update_otp
    SET
      otp = ?,
      expires_at = ?,
      attempts = 0,
      locked_until = NULL
    WHERE id = ?
    `,
    [otp, expires_at, id]
  );
};

exports.markAdminUpdateOtpVerified = async (id) => {
  await pool.query(
    `
    UPDATE admin_update_otp
    SET verified_at = NOW()
    WHERE id = ?
    `,
    [id]
  );
};



exports.getDashboardStats = async () => {
  try {
    const promises = [
      pool.query("SELECT COUNT(*) as count FROM orders"),
      pool.query("SELECT COUNT(*) as count FROM users"),
      pool.query("SELECT COUNT(*) as count FROM products"),
      pool.query("SELECT COUNT(*) as count FROM categories WHERE deleted_at IS NULL"),
      pool.query("SELECT COUNT(*) as count FROM coupons"),
      pool.query("SELECT COUNT(*) as count FROM banners"),
      pool.query(`
        SELECT COUNT(DISTINCT d.id) as count FROM deal_of_day d
        INNER JOIN products p ON d.product_id = p.id
        INNER JOIN product_variants v ON v.product_id = p.id AND v.is_default = 1
      `),
      pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'APPROVED' AND verified_by_admin = 1 THEN 1 END) as verified,
          COUNT(CASE WHEN status = 'REJECTED' THEN 1 END) as rejected
        FROM reviews WHERE deleted_at IS NULL
      `),
      pool.query("SELECT SUM(amount) as total FROM payments WHERE status = 'SUCCESS'"),
      pool.query(`
        SELECT o.*, p.payment_method, p.status as payment_status
        FROM orders o
        LEFT JOIN payments p ON o.order_id = p.order_id
        ORDER BY o.created_at DESC LIMIT 5
      `),
      pool.query(`
        SELECT p.*, (SELECT media_url FROM product_media pm WHERE pm.product_id = p.id AND pm.media_type = 'image' LIMIT 1) as thumbnail
        FROM products p
        ORDER BY p.created_at DESC LIMIT 5
      `),
      pool.query(`
        SELECT DATE(created_at) as date, SUM(amount) as sales, COUNT(*) as orders
        FROM payments
        WHERE status = 'SUCCESS' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at) ASC
      `),
      pool.query(`
        SELECT DATE(created_at) as date, COUNT(*) as orders
        FROM orders
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at) ASC
      `),
      pool.query(`
        SELECT c.id, c.name, COUNT(p.id) as productCount
        FROM categories c
        LEFT JOIN products p ON c.id = p.category_id
        GROUP BY c.id, c.name
        ORDER BY productCount DESC
      `)
    ];

    const results = await Promise.all(promises);

    const totalOrdersRows = results[0][0];
    const totalUsersRows = results[1][0];
    const totalProductsRows = results[2][0];
    const totalCategoriesRows = results[3][0];
    const totalCouponsRows = results[4][0];
    const totalBannersRows = results[5][0];
    const totalDealsRows = results[6][0];
    const reviewStatsRows = results[7][0];
    const totalPaymentsRows = results[8][0];
    const recentOrdersRows = results[9][0];
    const recentProductsRows = results[10][0];
    const salesTrendRows = results[11][0];
    const orderTrendRows = results[12][0];
    const categoryDistributionRows = results[13][0];

    // Fetch variants for recent products to get price/stock
    const productIds = recentProductsRows.map(p => p.id);
    let variants = [];
    if (productIds.length > 0) {
      const [vRows] = await pool.query("SELECT * FROM product_variants WHERE product_id IN (?)", [productIds]);
      variants = vRows;
    }

    const processedRecentProducts = recentProductsRows.map(p => {
      const pVariants = variants.filter(v => v.product_id === p.id);
      return { ...p, variants: pVariants };
    });

    return {
      totalOrders: totalOrdersRows[0].count,
      totalUsers: totalUsersRows[0].count,
      totalProducts: totalProductsRows[0].count,
      totalCategories: totalCategoriesRows[0].count,
      totalCoupons: totalCouponsRows[0].count,
      totalBanners: totalBannersRows[0].count,
      totalDeals: totalDealsRows[0].count,
      reviews: {
        total: reviewStatsRows[0].total || 0,
        pending: reviewStatsRows[0].pending || 0,
        verified: reviewStatsRows[0].verified || 0,
        rejected: reviewStatsRows[0].rejected || 0
      },
      totalPayments: totalPaymentsRows[0].total || 0,
      recentOrders: recentOrdersRows,
      recentProducts: processedRecentProducts,
      charts: {
        salesTrend: salesTrendRows,
        orderTrend: orderTrendRows,
        categoryDistribution: categoryDistributionRows
      }
    };
  } catch (err) {
    throw new Error("Error fetching dashboard stats: " + err.message);
  }
};
