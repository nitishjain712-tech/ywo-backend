const CodSettings = require("../models/codSettingsModel");

const CodSettingsController = {

  // 🔹 Get all
  getAll: async (req, res) => {
    try {
      const data = await CodSettings.getAll();
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // 🔹 Get active
  getActive: async (req, res) => {
    try {
      const data = await CodSettings.getActive();

      if (!data) {
        return res.status(404).json({
          success: false,
          message: "No active COD settings found",
        });
      }

      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // 🔹 Create
  create: async (req, res) => {
    try {
      const { max_cod_amount } = req.body;

      if (max_cod_amount === undefined || max_cod_amount <= 0) {
        return res.status(400).json({
          success: false,
          message: "max_cod_amount must be a positive number",
        });
      }

      const id = await CodSettings.create(max_cod_amount);

      res.json({
        success: true,
        message: "COD settings created successfully",
        id,
      });
    } catch (error) {
      if (error.message.includes("Only one COD settings")) {
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

  // 🔹 Update
  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { max_cod_amount, is_active } = req.body;

      const updated = await CodSettings.update(
        id,
        max_cod_amount,
        is_active
      );

      if (!updated) {
        return res.status(404).json({
          success: false,
          message: "Record not found",
        });
      }

      res.json({
        success: true,
        message: "COD settings updated successfully",
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // 🔹 Delete
  delete: async (req, res) => {
    try {
      const { id } = req.params;

      const deleted = await CodSettings.delete(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: "Record not found",
        });
      }

      res.json({
        success: true,
        message: "COD settings deleted successfully",
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
};

module.exports = CodSettingsController;
