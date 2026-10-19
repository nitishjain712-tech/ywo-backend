const pool = require("../config/db");

// ================== USER MANAGEMENT ==================

// ✅ Create new user (Signup)
exports.createUser = async ({ name, email, phone_number, password_hash }) => {
  try {
    const [result] = await pool.query(
      `INSERT INTO users (name, email, phone_number, password_hash) 
       VALUES (?, ?, ?, ?)`,
      [name, email.toLowerCase(), phone_number, password_hash]
    );
    return result.insertId;
  } catch (err) {
    throw new Error("Error creating user: " + err.message);
  }
};

exports.getAllUsersWithAllAddresses = async (page, limit, offset, search = "") => {

  let whereQuery = "";
  let values = [];

  if (search) {
    whereQuery = `WHERE name LIKE ? OR email LIKE ? OR phone_number LIKE ?`;
    const like = `%${search}%`;
    values.push(like, like, like);
  }

  // 🔹 Get total count
  const [[{ count: totalUsers }]] = await pool.query(`
    SELECT COUNT(*) as count FROM users ${whereQuery}
  `, search ? values : []);

  // 🔹 Paginated users
  const [userRows] = await pool.query(
    `
     SELECT id, name, email, phone_number
     FROM users
     ${whereQuery}
     ORDER BY id DESC
     LIMIT ? OFFSET ?
    `,
    search ? [...values, limit, offset] : [limit, offset]
  );

  if (userRows.length === 0) return { users: [], totalUsers };

  const userIds = userRows.map(u => u.id);

  // 🔹 Get addresses for these users
  const [addressRows] = await pool.query(
    `SELECT 
        id, user_id, address_line1, address_line2, city, state, country, pincode, is_default
     FROM user_addresses
     WHERE user_id IN (?)`,
    [userIds]
  );

  // 🔹 Group addresses
  const users = userRows.map(u => {
    const userAddresses = addressRows.filter(a => a.user_id === u.id);
    
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      phone_number: u.phone_number,
      addresses: userAddresses.map(a => ({
        id: a.id,
        address_line1: a.address_line1,
        address_line2: a.address_line2,
        city: a.city,
        state: a.state,
        country: a.country,
        pincode: a.pincode,
        is_default: a.is_default === 1
      }))
    }
  });

  return { users, totalUsers };
};



// ✅ Find user by email
exports.findByEmail = async (email) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM users WHERE email = ? LIMIT 1",
      [email.toLowerCase()]
    );
    return rows[0] || null;
  } catch (err) {
    throw new Error("Error finding user: " + err.message);
  }
};

// ✅ Find user by email OR phone (for login flexibility)
exports.findByEmailOrPhone = async (email, phone_number) => {
  const [rows] = await pool.query(
    "SELECT * FROM users WHERE email = ? OR phone_number = ? LIMIT 1",
    [email, phone_number]
  );
  return rows[0];
};

// Find user by both email & phone
exports.findByEmailAndPhone = async (email, phone_number) => {
  const [rows] = await pool.query(
    "SELECT * FROM users WHERE email = ? AND phone_number = ?",
    [email, phone_number]
  );
  return rows[0]; // return first match or undefined
};

// Find user by email
exports.findByEmail = async (email) => {
  const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
  return rows[0];
};

// Find user by phone
exports.findByPhone = async (phone_number) => {
  const [rows] = await pool.query("SELECT * FROM users WHERE phone_number = ?", [phone_number]);
  return rows[0];
};


// ✅ Get profile by ID
exports.getUserById = async (id) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
          id, 
          name, 
          email, 
          phone_number, 
          gst_number,       -- ✅ Added GST number here
          is_active, 
          is_verified, 
          created_at, 
          last_login
       FROM users 
       WHERE id = ?`,
      [id]
    );
    return rows[0] || null;
  } catch (err) {
    throw new Error("Error fetching user: " + err.message);
  }
};


exports.getAllUsersWithAddresses = async ({ page = 1, limit = 20, search = "" }) => {
  try {
    const offset = (page - 1) * limit;
    const params = [];
    let whereClause = "";

    // 🔍 Optional search (name, email, or phone)
    if (search) {
      whereClause = `WHERE (LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ? OR u.phone_number LIKE ?)`;
      const s = `%${search.toLowerCase()}%`;
      params.push(s, s, s);
    }

    // 1️⃣ Fetch paginated users
    const [users] = await pool.query(
      `
      SELECT 
        u.id AS user_id,
        u.name,
        u.email,
        u.phone_number,
        u.is_active,
        u.is_verified,
        u.created_at,
        u.updated_at,
        u.last_login
      FROM users u
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, parseInt(limit), parseInt(offset)]
    );

    if (!users.length) {
      return { users: [], total: 0, page, limit };
    }

    // 2️⃣ Count total for pagination
    const [countRows] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM users u
      ${whereClause}
      `,
      params
    );
    const total = countRows[0]?.total || 0;

    // 3️⃣ Fetch all addresses for these users
    const userIds = users.map((u) => u.user_id);
    const [addresses] = await pool.query(
      `
      SELECT 
        a.id AS address_id,
        a.user_id,
        a.address_line1,
        a.address_line2,
        a.city,
        a.state,
        a.country,
        a.pincode,
        a.is_default,
        a.created_at,
        a.updated_at
      FROM user_addresses a
      WHERE a.user_id IN (?)
      ORDER BY a.user_id, a.created_at DESC
      `,
      [userIds]
    );

    // 4️⃣ Group addresses per user
    const userMap = {};
    users.forEach((u) => {
      userMap[u.user_id] = { ...u, addresses: [] };
    });

    addresses.forEach((addr) => {
      if (userMap[addr.user_id]) {
        userMap[addr.user_id].addresses.push(addr);
      }
    });

    // ✅ Return final structured data
    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      users: Object.values(userMap),
    };
  } catch (err) {
    throw new Error("Error fetching users with addresses: " + err.message);
  }
};


exports.getAllUsersForExport = async (filters = {}) => {
  try {
    const { from, to, is_active, is_verified, search } = filters;
    let conditions = [];
    let values = [];

    // Apply filters
    if (from) {
      conditions.push("u.created_at >= ?");
      values.push(from);
    }
    if (to) {
      conditions.push("u.created_at <= ?");
      values.push(to);
    }
    if (is_active !== undefined) {
      conditions.push("u.is_active = ?");
      values.push(is_active === "true" ? 1 : 0);
    }
    if (is_verified !== undefined) {
      conditions.push("u.is_verified = ?");
      values.push(is_verified === "true" ? 1 : 0);
    }
    if (search) {
      conditions.push("(u.name LIKE ? OR u.email LIKE ? OR u.phone_number LIKE ?)");
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // ✅ Main Query — Aggregates all addresses into JSON array
    const [rows] = await pool.query(
      `
      SELECT 
        u.id AS user_id,
        u.name,
        u.email,
        u.phone_number,
        u.is_active,
        u.is_verified,
        u.last_login,
        u.created_at,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', a.id,
            'address_line1', a.address_line1,
            'address_line2', a.address_line2,
            'city', a.city,
            'state', a.state,
            'country', a.country,
            'pincode', a.pincode,
            'is_default', a.is_default,
            'created_at', a.created_at,
            'updated_at', a.updated_at
          )
        ) AS addresses
      FROM users u
      LEFT JOIN user_addresses a ON u.id = a.user_id
      ${whereClause}
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `,
      values
    );

    // Convert JSON from MySQL string → JS object
    const result = rows.map((user) => ({
      ...user,
      addresses: JSON.parse(user.addresses || "[]"),
    }));

    return result;
  } catch (err) {
    throw new Error("Error fetching users for export: " + err.message);
  }
};



exports.getAllUsers = async () => {
  try {
    const [rows] = await pool.query("SELECT * FROM users");
    return rows;
  } catch (err) {
    throw new Error("Error fetching users: " + err.message);
  }
};

exports.getAllUsersWithDefaultAddress = async () => {
  const [rows] = await pool.query(
    `SELECT 
        u.id,
        u.name,
        u.email,
        u.phone_number,
        a.id AS address_id,
        a.address_line1,
        a.address_line2,
        a.city,
        a.state,
        a.country,
        a.pincode
     FROM users u
     LEFT JOIN user_addresses a 
       ON a.user_id = u.id AND a.is_default = 1
     ORDER BY u.id DESC`
  );

  // Group users and attach address
  const users = rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone_number: row.phone_number,
    default_address: row.address_id
      ? {
          id: row.address_id,
          address_line1: row.address_line1,
          address_line2: row.address_line2,
          city: row.city,
          state: row.state,
          country: row.country,
          pincode: row.pincode,
        }
      : null,
  }));

  return users;
};

exports.getUserByIdWithPassword = async (id) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, phone_number, password_hash, is_active, 
              is_verified, created_at, last_login 
       FROM users WHERE id = ?`,
      [id]
    );
    return rows[0] || null;
  } catch (err) {
    throw new Error("Error fetching user: " + err.message);
  }
};


exports.deleteSpecificRefreshToken = async (token) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM refresh_tokens WHERE token = ?",
      [token]
    );
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error deleting specific refresh token: " + err.message);
  }
};

// ✅ Update user profile
exports.updateUser = async (id, userData) => {
  try {
    if (!Object.keys(userData).length) {
      throw new Error("No fields provided for update");
    }

    const fields = Object.keys(userData).map((key) => `${key} = ?`).join(", ");
    const values = [...Object.values(userData), id];

    const sql = `UPDATE users 
                 SET ${fields}, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`;
    const [result] = await pool.query(sql, values);
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error updating user: " + err.message);
  }
};

// ✅ Update last login timestamp
exports.updateLastLogin = async (id) => {
  try {
    const [result] = await pool.query(
      "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?",
      [id]
    );
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error updating last login: " + err.message);
  }
};

// ================== OTP PASSWORD RESET ==================

// ✅ Save OTP for password reset
exports.setPasswordResetOTP = async (email, otp, expiresAt) => {
  try {
    const [result] = await pool.query(
      `UPDATE users 
       SET password_reset_otp = ?, password_reset_expires = ? 
       WHERE email = ?`,
      [otp, expiresAt, email.toLowerCase()]
    );
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error setting password reset OTP: " + err.message);
  }
};

exports.setPasswordResetOTPById = async (userId, otp, expiresAt) => {
  try {
    if (!userId || (typeof userId !== 'number' && typeof userId !== 'string')) {
      throw new Error('Invalid userId parameter: userId must be a valid number or string');
    }

    const [result] = await pool.query(
      `UPDATE users 
       SET password_reset_otp = ?, password_reset_expires = ? 
       WHERE id = ?`,
      [otp, expiresAt, userId]
    );
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error setting password reset OTP: " + err.message);
  }
};

// ✅ Verify OTP
exports.verifyPasswordResetOTP = async (email, otp) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM users 
       WHERE email = ? AND password_reset_otp = ? 
         AND password_reset_expires > NOW() 
       LIMIT 1`,
      [email.toLowerCase(), otp]
    );
    return rows[0] || null;
  } catch (err) {
    throw new Error("Error verifying OTP: " + err.message);
  }
};

// ✅ Clear OTP fields after reset
exports.clearPasswordResetOTP = async (email) => {
  try {
    const [result] = await pool.query(
      `UPDATE users 
       SET password_reset_otp = NULL, password_reset_expires = NULL 
       WHERE email = ?`,
      [email.toLowerCase()]
    );
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error clearing password reset OTP: " + err.message);
  }
};

// ✅ Update password
exports.updatePassword = async (email, newPasswordHash) => {
  try {
    const [result] = await pool.query(
      `UPDATE users 
       SET password_hash = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE email = ?`,
      [newPasswordHash, email.toLowerCase()]
    );
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error updating password: " + err.message);
  }
};

exports.updatePasswordById = async (userId, newPasswordHash) => {
  try {
    const [result] = await pool.query(
      `UPDATE users 
       SET password_hash = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [newPasswordHash, userId]
    );
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error updating password: " + err.message);
  }
};

// ================== EMAIL VERIFICATION ==================

// ✅ Mark user as verified
exports.markUserAsVerified = async (email) => {
  try {
    const [result] = await pool.query(
      `UPDATE users 
       SET is_verified = TRUE, updated_at = CURRENT_TIMESTAMP 
       WHERE email = ?`,
      [email.toLowerCase()]
    );
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error marking user as verified: " + err.message);
  }
};

// ================== USER ADDRESSES ==================

// ✅ Add address
exports.addAddress = async (addressData) => {
  try {
    const {
      user_id,
      address_line1,
      address_line2,
      city,
      state,
      country,
      pincode,
      is_default,
    } = addressData;

    // Ensure only 1 default address
    if (is_default) {
      await pool.query(
        "UPDATE user_addresses SET is_default = FALSE WHERE user_id = ?",
        [user_id]
      );
    }

    const [result] = await pool.query(
      `INSERT INTO user_addresses 
       (user_id, address_line1, address_line2, city, state, country, pincode, is_default) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        address_line1,
        address_line2,
        city,
        state,
        country || "India",
        pincode,
        is_default || false,
      ]
    );

    return result.insertId;
  } catch (err) {
    throw new Error("Error adding address: " + err.message);
  }
};


// ✅ Get all addresses
exports.getAddressesByUserId = async (userId) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM user_addresses 
       WHERE user_id = ? 
       ORDER BY is_default DESC, created_at DESC`,
      [userId]
    );
    return rows;
  } catch (err) {
    throw new Error("Error fetching addresses: " + err.message);
  }
};

// ✅ Get address by ID
exports.getAddressById = async (id, userId) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM user_addresses 
       WHERE id = ? AND user_id = ? LIMIT 1`,
      [id, userId]
    );
    return rows[0] || null;
  } catch (err) {
    throw new Error("Error fetching address: " + err.message);
  }
};

// ✅ Update address
exports.updateAddress = async (id, userId, addressData) => {
  try {
    if (!Object.keys(addressData).length) {
      throw new Error("No fields provided for update");
    }

    // If setting a new default, reset others
    if (addressData.is_default) {
      await pool.query(
        "UPDATE user_addresses SET is_default = FALSE WHERE user_id = ?",
        [userId]
      );
    }

    // Build update dynamically
    const fields = Object.keys(addressData)
      .map((key) => `${key} = ?`)
      .join(", ");

    const values = [...Object.values(addressData), id, userId];

    const sql = `
      UPDATE user_addresses 
      SET ${fields}, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ? AND user_id = ?
    `;

    const [result] = await pool.query(sql, values);
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error updating address: " + err.message);
  }
};

exports.updateGSTNumber = async (userId, gst_number) => {
  const [result] = await pool.query(
    "UPDATE users SET gst_number = ?, updated_at = NOW() WHERE id = ?",
    [gst_number, userId]
  );
  return result.affectedRows > 0;
};

exports.getGSTNumber = async (userId) => {
  const [rows] = await pool.query(
    `SELECT gst_number FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  return rows.length ? rows[0] : null;
};




// ✅ Delete address
exports.deleteAddress = async (id, userId) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM user_addresses WHERE id = ? AND user_id = ?",
      [id, userId]
    );
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error deleting address: " + err.message);
  }
};

// ✅ Get default address
exports.getDefaultAddress = async (userId) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM user_addresses WHERE user_id = ? AND is_default = TRUE LIMIT 1",
      [userId]
    );
    return rows[0] || null;
  } catch (err) {
    throw new Error("Error fetching default address: " + err.message);
  }
};

// ✅ Set default address
exports.setDefaultAddress = async (id, userId) => {
  try {
    await pool.query(
      "UPDATE user_addresses SET is_default = FALSE WHERE user_id = ?",
      [userId]
    );

    const [result] = await pool.query(
      "UPDATE user_addresses SET is_default = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
      [id, userId]
    );

    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error setting default address: " + err.message);
  }
};


// ================== REFRESH TOKEN MANAGEMENT ==================

// ✅ Store or update refresh token
exports.storeRefreshToken = async (userId, refreshToken, expiresAt) => {
  try {
    const [existing] = await pool.query(
      "SELECT id FROM refresh_tokens WHERE user_id = ?",
      [userId]
    );

    if (existing.length > 0) {
      await pool.query(
        "UPDATE refresh_tokens SET token = ?, expires_at = ?, created_at = CURRENT_TIMESTAMP WHERE user_id = ?",
        [refreshToken, expiresAt, userId]
      );
    } else {
      await pool.query(
        "INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
        [userId, refreshToken, expiresAt]
      );
    }
    return true;
  } catch (err) {
    throw new Error("Error storing refresh token: " + err.message);
  }
};

// ✅ Verify refresh token
exports.verifyRefreshToken = async (refreshToken) => {
  try {
    const [rows] = await pool.query(
      `SELECT rt.*, u.id AS user_id, u.email, u.is_active 
       FROM refresh_tokens rt 
       JOIN users u ON rt.user_id = u.id 
       WHERE rt.token = ? AND rt.expires_at > NOW() 
       LIMIT 1`,
      [refreshToken]
    );
    return rows[0] || null;
  } catch (err) {
    throw new Error("Error verifying refresh token: " + err.message);
  }
};

// ✅ Delete refresh token (logout)
exports.deleteRefreshToken = async (userId) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM refresh_tokens WHERE user_id = ?",
      [userId]
    );
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error deleting refresh token: " + err.message);
  }
};
