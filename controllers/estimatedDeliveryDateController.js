const logger = require("../utils/logger");
const EstimatedDeliveryDate = require("../models/estimatedDeliveryDateModel");

const EstimatedDeliveryDateController = {

  // Get all
  getAll: async (req, res) => {
    try {
      const data = await EstimatedDeliveryDate.getAll();
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },

  // ⭐ Get latest row
  getLatest: async (req, res) => {
    try {
      const latest = await EstimatedDeliveryDate.getLatest();

      if (!latest) {
        return res.status(404).json({
          success: false,
          message: "No records found"
        });
      }

      res.json({ success: true, data: latest });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },

  // Get one
  getOne: async (req, res) => {
    try {
      const { id } = req.params;
      const item = await EstimatedDeliveryDate.getById(id);

      if (!item)
        return res.status(404).json({ success: false, message: "Record not found" });

      res.json({ success: true, data: item });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },

  // Create
create: async (req, res) => {
  try {
    const { estimated_delivery_date } = req.body;

    if (!estimated_delivery_date) {
      return res
        .status(400)
        .json({ success: false, message: "estimated_delivery_date is required" });
    }

    const id = await EstimatedDeliveryDate.create(estimated_delivery_date);

    return res.json({
      success: true,
      message: "Created successfully",
      id,
    });
  } catch (error) {
    // Custom error from Model
    if (error.message === "Only one estimated delivery message is allowed. Please update the existing message.") {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    // Other unknown errors
    logger.error("Controller create error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
},

  // Update
  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { estimated_delivery_date } = req.body;

      const updated = await EstimatedDeliveryDate.update(id, estimated_delivery_date);

      if (!updated)
        return res.status(404).json({ success: false, message: "Record not found" });

      res.json({ success: true, message: "Updated successfully" });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },

  // Delete
  delete: async (req, res) => {
    try {
      const { id } = req.params;

      const deleted = await EstimatedDeliveryDate.delete(id);

      if (!deleted)
        return res.status(404).json({ success: false, message: "Record not found" });

      res.json({ success: true, message: "Deleted successfully" });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
};

module.exports = EstimatedDeliveryDateController;
