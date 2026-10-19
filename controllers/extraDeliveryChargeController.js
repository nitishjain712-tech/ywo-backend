const ExtraDeliveryCharge = require("../models/extraDeliveryChargeModel");

const ExtraDeliveryChargeController = {

  // Get all
  getAll: async (req, res) => {
    try {
      const data = await ExtraDeliveryCharge.getAll();
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Get active
  getActive: async (req, res) => {
    try {
      const data = await ExtraDeliveryCharge.getActive();

      if (!data) {
        return res.status(404).json({
          success: false,
          message: "No active extra delivery charge found",
        });
      }

      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Create
  create: async (req, res) => {
    try {
      const { charge_type, charge_value } = req.body;

      if (!["percentage", "fixed"].includes(charge_type)) {
        return res.status(400).json({
          success: false,
          message: "charge_type must be 'percentage' or 'fixed'",
        });
      }

      if (charge_value === undefined || charge_value < 0) {
        return res.status(400).json({
          success: false,
          message: "charge_value must be a positive number",
        });
      }

      const id = await ExtraDeliveryCharge.create(charge_type, charge_value);

      res.json({
        success: true,
        message: "Extra delivery charge created",
        id,
      });
    } catch (error) {
      if (error.message.includes("Only one extra delivery charge")) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  },

  // Update
  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { charge_type, charge_value, is_active } = req.body;

      const updated = await ExtraDeliveryCharge.update(
        id,
        charge_type,
        charge_value,
        is_active
      );

      if (!updated) {
        return res.status(404).json({
          success: false,
          message: "Record not found",
        });
      }

      res.json({ success: true, message: "Updated successfully" });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Delete
  delete: async (req, res) => {
    try {
      const { id } = req.params;

      const deleted = await ExtraDeliveryCharge.delete(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: "Record not found",
        });
      }

      res.json({ success: true, message: "Deleted successfully" });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
};

module.exports = ExtraDeliveryChargeController;
