const pool = require("../config/db");

const CodSettings = {

  // 🔹 Get all records
  getAll: async () => {
    const [rows] = await pool.query(
      "SELECT * FROM cod_settings ORDER BY created_at DESC"
    );
    return rows;
  },

  // 🔹 Get active COD rule
  getActive: async () => {
    const [rows] = await pool.query(
      "SELECT * FROM cod_settings WHERE is_active = 1 LIMIT 1"
    );
    return rows[0] || null;
  },

  // 🔹 Get by ID
  getById: async (id) => {
    const [rows] = await pool.query(
      "SELECT * FROM cod_settings WHERE id = ?",
      [id]
    );
    return rows[0] || null;
  },

  // 🔹 Create (allow only one row)
  create: async (max_cod_amount) => {
    const [[{ count }]] = await pool.query(
      "SELECT COUNT(*) AS count FROM cod_settings"
    );

    if (count >= 1) {
      throw new Error(
        "Only one COD settings configuration is allowed. Please update the existing one."
      );
    }

    const [result] = await pool.query(
      `INSERT INTO cod_settings (max_cod_amount)
       VALUES (?)`,
      [max_cod_amount]
    );

    return result.insertId;
  },

  // 🔹 Update
  update: async (id, max_cod_amount, is_active) => {
    const [result] = await pool.query(
      `UPDATE cod_settings
       SET max_cod_amount = ?, is_active = ?
       WHERE id = ?`,
      [max_cod_amount, is_active, id]
    );
    return result.affectedRows;
  },

  // 🔹 Delete
  delete: async (id) => {
    const [result] = await pool.query(
      "DELETE FROM cod_settings WHERE id = ?",
      [id]
    );
    return result.affectedRows;
  },
};

module.exports = CodSettings;
