const pool = require("../config/db");

const Contact = {
  // ➕ Create Contact Inquiry
  create: async ({
    name,
    email,
    phone = null,
    subject,
    category = "General",
    message,
    ip_address = null,
    user_agent = null,
  }) => {
    const [result] = await pool.query(
      `INSERT INTO contact_messages 
       (name, email, phone, subject, category, message, ip_address, user_agent, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
      [name, email, phone, subject, category, message, ip_address, user_agent]
    );
    return result.insertId;
  },

  // 📋 Get All Contact Inquiries (Admin)
  getAll: async ({ status, page = 1, limit = 20 } = {}) => {
    const offset = (Number(page) - 1) * Number(limit);
    let query = "SELECT * FROM contact_messages";
    const params = [];

    if (status && status !== "all") {
      query += " WHERE status = ?";
      params.push(status);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(Number(limit), Number(offset));

    const [rows] = await pool.query(query, params);

    // Get total count
    let countQuery = "SELECT COUNT(*) as total FROM contact_messages";
    const countParams = [];
    if (status && status !== "all") {
      countQuery += " WHERE status = ?";
      countParams.push(status);
    }
    const [countResult] = await pool.query(countQuery, countParams);

    return {
      messages: rows,
      total: countResult[0]?.total || 0,
      page: Number(page),
      totalPages: Math.ceil((countResult[0]?.total || 0) / Number(limit)),
    };
  },

  // 🔍 Get Single Contact Inquiry
  getById: async (id) => {
    const [rows] = await pool.query(
      "SELECT * FROM contact_messages WHERE id = ?",
      [id]
    );
    return rows[0] || null;
  },

  // ✏️ Update Status
  updateStatus: async (id, status) => {
    const [result] = await pool.query(
      "UPDATE contact_messages SET status = ? WHERE id = ?",
      [status, id]
    );
    return result.affectedRows > 0;
  },

  // ❌ Delete Contact Inquiry
  delete: async (id) => {
    const [result] = await pool.query(
      "DELETE FROM contact_messages WHERE id = ?",
      [id]
    );
    return result.affectedRows > 0;
  },
};

module.exports = Contact;
