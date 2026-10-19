const pool = require("../config/db");

const TermsConditions = {
  // 📋 Get all terms
  getAll: async () => {
    const [rows] = await pool.query("SELECT * FROM terms_conditions ORDER BY created_at DESC");
    return rows;
  },

  getAllActive: async () => {
    const [rows] = await pool.query("SELECT * FROM terms_conditions WHERE is_active = 1 ORDER BY created_at DESC");
    return rows;
  },

  // 🔍 Get single term
  getById: async (id) => {
    const [rows] = await pool.query("SELECT * FROM terms_conditions WHERE id = ?", [id]);
    return rows[0];
  },

  // ➕ Create new term
  create: async ({ title, content, is_active }) => {
    const [result] = await pool.query(
      "INSERT INTO terms_conditions (title, content, is_active) VALUES (?, ?, ?)",
      [title, content, is_active ?? true]
    );
    return result.insertId;
  },

  // ✏️ Update term
  update: async (id, { title, content, is_active }) => {
    const [result] = await pool.query(
      "UPDATE terms_conditions SET title = ?, content = ?, is_active = ? WHERE id = ?",
      [title, content, is_active, id]
    );
    return result.affectedRows > 0;
  },

  // ❌ Delete term
  delete: async (id) => {
    const [result] = await pool.query("DELETE FROM terms_conditions WHERE id = ?", [id]);
    return result.affectedRows > 0;
  },
};

module.exports = TermsConditions;
