const pool = require("../config/db");

const PrivacyPolicy = {
  // 📋 Get all policies
  getAll: async () => {
    const [rows] = await pool.query("SELECT * FROM privacy_policies ORDER BY created_at DESC");
    return rows;
  },

  getAllActivePolicies: async () => {
    const [rows] = await pool.query("SELECT * FROM privacy_policies WHERE is_active = 1 ORDER BY created_at DESC");
    return rows;
  },

  // 🔍 Get single policy
  getById: async (id) => {
    const [rows] = await pool.query("SELECT * FROM privacy_policies WHERE id = ?", [id]);
    return rows[0];
  },

  // ➕ Create new policy
  create: async ({ title, content, is_active }) => {
    const [result] = await pool.query(
      "INSERT INTO privacy_policies (title, content, is_active) VALUES (?, ?, ?)",
      [title, content, is_active ?? true]
    );
    return result.insertId;
  },

  // ✏️ Update policy
  update: async (id, { title, content, is_active }) => {
    const [result] = await pool.query(
      "UPDATE privacy_policies SET title = ?, content = ?, is_active = ? WHERE id = ?",
      [title, content, is_active, id]
    );
    return result.affectedRows > 0;
  },

  // ❌ Delete policy
  delete: async (id) => {
    const [result] = await pool.query("DELETE FROM privacy_policies WHERE id = ?", [id]);
    return result.affectedRows > 0;
  },
};

module.exports = PrivacyPolicy;
