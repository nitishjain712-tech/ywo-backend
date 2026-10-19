const logger = require("../utils/logger");
const pool = require("../config/db");

const EstimatedDeliveryDate = {

  // Get all
  getAll: async () => {
    try {
      const [rows] = await pool.query(
        "SELECT * FROM estimated_delivery_dates ORDER BY created_at DESC"
      );
      return rows;
    } catch (error) {
      logger.error("Error fetching all delivery dates:", error);
      throw new Error("Failed to fetch all estimated delivery dates");
    }
  },

  // Get latest row
  getLatest: async () => {
    try {
      const [rows] = await pool.query(
        "SELECT * FROM estimated_delivery_dates ORDER BY created_at DESC LIMIT 1"
      );
      return rows[0] || null;
    } catch (error) {
      logger.error("Error fetching latest delivery date:", error);
      throw new Error("Failed to fetch latest estimated delivery date");
    }
  },

  // Get by ID
  getById: async (id) => {
    try {
      const [rows] = await pool.query(
        "SELECT * FROM estimated_delivery_dates WHERE id = ?",
        [id]
      );
      return rows[0] || null;
    } catch (error) {
      logger.error(`Error fetching delivery date with id ${id}:`, error);
      throw new Error("Failed to fetch estimated delivery date by ID");
    }
  },

  // Create
// Create (Allow only 1 row)

// Create (Allow only 1 row)
create: async (estimated_delivery_date) => {
  try {
    // Check if any row already exists
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS count FROM estimated_delivery_dates"
    );

    if (rows[0].count >= 1) {
      throw new Error("Only one estimated delivery message is allowed. Please update the existing message.");
    }

    // If no row exists → allow creation
    const [result] = await pool.query(
      "INSERT INTO estimated_delivery_dates (estimated_delivery_date) VALUES (?)",
      [estimated_delivery_date]
    );

    return result.insertId;
  } catch (error) {
    logger.error("Error creating new delivery date:", error);
    throw new Error(error.message || "Failed to create estimated delivery date");
  }
},

  // Update
  update: async (id, estimated_delivery_date) => {
    try {
      const [result] = await pool.query(
        "UPDATE estimated_delivery_dates SET estimated_delivery_date = ? WHERE id = ?",
        [estimated_delivery_date, id]
      );
      return result.affectedRows;
    } catch (error) {
      logger.error(`Error updating delivery date with id ${id}:`, error);
      throw new Error("Failed to update estimated delivery date");
    }
  },

  // Delete
  delete: async (id) => {
    try {
      const [result] = await pool.query(
        "DELETE FROM estimated_delivery_dates WHERE id = ?",
        [id]
      );
      return result.affectedRows;
    } catch (error) {
      logger.error(`Error deleting delivery date with id ${id}:`, error);
      throw new Error("Failed to delete estimated delivery date");
    }
  }

};

module.exports = EstimatedDeliveryDate;
