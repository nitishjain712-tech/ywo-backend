const pool = require("../config/db");

const FAQ = {
  // 📋 Get all FAQs
  getAll: async () => {
    const [rows] = await pool.query("SELECT * FROM faqs ORDER BY created_at DESC");
    return rows;
  },

   getAllActiveFAQs: async () => {
    const [rows] = await pool.query("SELECT * FROM faqs WHERE is_active = 1 ORDER BY created_at DESC");
    return rows;
  },

  // 🔍 Get single FAQ
  getById: async (id) => {
    const [rows] = await pool.query("SELECT * FROM faqs WHERE id = ?", [id]);
    return rows[0];
  },

  // ➕ Create FAQ
  create: async ({ question, answer, is_active }) => {
    const [result] = await pool.query(
      "INSERT INTO faqs (question, answer, is_active) VALUES (?, ?, ?)",
      [question, answer, is_active ?? true]
    );
    return result.insertId;
  },

  // ✏️ Update FAQ
  update: async (id, { question, answer, is_active }) => {
    const [result] = await pool.query(
      "UPDATE faqs SET question = ?, answer = ?, is_active = ? WHERE id = ?",
      [question, answer, is_active, id]
    );
    return result.affectedRows > 0;
  },

  // ❌ Delete FAQ
  delete: async (id) => {
    const [result] = await pool.query("DELETE FROM faqs WHERE id = ?", [id]);
    return result.affectedRows > 0;
  },
};

module.exports = FAQ;
