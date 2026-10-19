const pool = require("../config/db");

// 🧾 Get all charges
exports.getAllCharges = async () => {
  const [rows] = await pool.query("SELECT * FROM charges ORDER BY id ASC");
  return rows;
};

// 🔍 Get charge by type (COD or ADDITIONAL)
exports.getChargeByType = async (charge_name) => {
  const [rows] = await pool.query(
    "SELECT * FROM charges WHERE charge_name = ? AND is_active = 1",
    [charge_name]
  );
  return rows[0];
};


// ➕ Create charge
exports.createCharge = async (data) => {
  const { charge_name, amount, charge_type, is_active } = data;
  const [result] = await pool.query(
    "INSERT INTO charges (charge_name, amount, charge_type, is_active) VALUES (?, ?, ?, ?)",
    [charge_name, amount, charge_type, is_active]
  );
  return { id: result.insertId, ...data };
};

// ✏️ Update charge details
exports.updateCharge = async (charge_name, data) => {
  const { amount, charge_type, is_active } = data;
  const [result] = await pool.query(
    "UPDATE charges SET amount = ?, charge_type = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE charge_name = ?",
    [amount, charge_type, is_active, charge_name]
  );
  return result.affectedRows;
};

// ❌ Delete charge
exports.deleteCharge = async (charge_name) => {
  const [result] = await pool.query("DELETE FROM charges WHERE charge_name = ?", [charge_name]);
  return result.affectedRows;
};

// 🔁 Toggle charge active/inactive
exports.toggleChargeStatus = async (charge_name) => {
  const [rows] = await pool.query("SELECT is_active FROM charges WHERE charge_name = ?", [charge_name]);
  const charge = rows[0];
  if (!charge) return null;

  const newStatus = charge.is_active ? 0 : 1;
  const [result] = await pool.query(
    "UPDATE charges SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE charge_name = ?",
    [newStatus, charge_name]
  );
  return { updated: result.affectedRows, newStatus };
};
