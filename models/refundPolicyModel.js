const pool = require("../config/db");

const RefundPolicy = {
  // ➕ Create Refund Policy
  create: async ({ title, content, is_active = true }) => {
    const [result] = await pool.query(
      `INSERT INTO refund_policies (title, content, is_active) VALUES (?, ?, ?)`,
      [title, content, is_active]
    );
    return result.insertId;
  },

  // 🔍 Get All Refund Policies
  getAll: async () => {
    const [rows] = await pool.query(
      `SELECT * FROM refund_policies ORDER BY created_at DESC`
    );
    return rows;
  },

  // 🔍 Get All Active Refund Policies
  getAllActive: async () => {
    const [rows] = await pool.query(
      `SELECT * FROM refund_policies WHERE is_active = 1 ORDER BY created_at DESC`
    );
    return rows;
  },

  // 🔍 Get Single Refund Policy
  getById: async (id) => {
    const [rows] = await pool.query(
      `SELECT * FROM refund_policies WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0];
  },

  // ✏️ Update Refund Policy
  update: async (id, { title, content, is_active }) => {
    await pool.query(
      `UPDATE refund_policies SET title = ?, content = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [title, content, is_active, id]
    );
    return true;
  },

  // 🗑️ Delete Refund Policy
  delete: async (id) => {
    await pool.query(`DELETE FROM refund_policies WHERE id = ?`, [id]);
    return true;
  },
};

module.exports = RefundPolicy;
