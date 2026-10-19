const pool = require("../config/db");

const ShippingPolicy = {
  // 📦 Get all policies
  getAll: async () => {
    const [rows] = await pool.query("SELECT * FROM shipping_policies ORDER BY created_at DESC");
    return rows;
  },

  // 🔍 Get single policy
  getById: async (id) => {
    const [rows] = await pool.query("SELECT * FROM shipping_policies WHERE id = ?", [id]);
    return rows[0];
  },

  // ➕ Create new policy
  create: async ({ title, content, is_active }) => {
    const [result] = await pool.query(
      "INSERT INTO shipping_policies (title, content, is_active) VALUES (?, ?, ?)",
      [title, content, is_active ?? true]
    );
    return result.insertId;
  },

  // ✏️ Update policy
  update: async (id, { title, content, is_active }) => {
    const [result] = await pool.query(
      "UPDATE shipping_policies SET title = ?, content = ?, is_active = ? WHERE id = ?",
      [title, content, is_active, id]
    );
    return result.affectedRows > 0;
  },

  // ❌ Delete policy
  delete: async (id) => {
    const [result] = await pool.query("DELETE FROM shipping_policies WHERE id = ?", [id]);
    return result.affectedRows > 0;
  },
};

module.exports = ShippingPolicy;
