const pool = require("../config/db");

const ExtraDeliveryCharge = {

  // Get all
  getAll: async () => {
    const [rows] = await pool.query(
      "SELECT * FROM extra_delivery_charges ORDER BY created_at DESC"
    );
    return rows;
  },

  // Get active/latest
  getActive: async () => {
    const [rows] = await pool.query(
      "SELECT * FROM extra_delivery_charges WHERE is_active = 1 LIMIT 1"
    );
    return rows[0] || null;
  },

  // Get by ID
  getById: async (id) => {
    const [rows] = await pool.query(
      "SELECT * FROM extra_delivery_charges WHERE id = ?",
      [id]
    );
    return rows[0] || null;
  },

  // Create (Allow only 1 row)
  create: async (charge_type, charge_value) => {
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS count FROM extra_delivery_charges"
    );

    if (rows[0].count >= 1) {
      throw new Error(
        "Only one extra delivery charge configuration is allowed. Please update the existing one."
      );
    }

    const [result] = await pool.query(
      `INSERT INTO extra_delivery_charges (charge_type, charge_value)
       VALUES (?, ?)`,
      [charge_type, charge_value]
    );

    return result.insertId;
  },

  // Update
  update: async (id, charge_type, charge_value, is_active) => {
    const [result] = await pool.query(
      `UPDATE extra_delivery_charges
       SET charge_type = ?, charge_value = ?, is_active = ?
       WHERE id = ?`,
      [charge_type, charge_value, is_active, id]
    );
    return result.affectedRows;
  },

  // Delete
  delete: async (id) => {
    const [result] = await pool.query(
      "DELETE FROM extra_delivery_charges WHERE id = ?",
      [id]
    );
    return result.affectedRows;
  },
};

module.exports = ExtraDeliveryCharge;
