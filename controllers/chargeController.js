const logger = require("../utils/logger");
const Charge = require("../models/chargeModel");

// ✅ Get all charges
exports.getAllCharges = async (req, res) => {
  try {
    const charges = await Charge.getAllCharges();
    return res.json({ success: true, data: charges });
  } catch (err) {
    logger.error("getAllCharges error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ Get COD charge
exports.getCODCharge = async (req, res) => {
  try {
    const charge = await Charge.getChargeByType("COD");
    if (!charge)
      return res.status(404).json({
        success: false,
        message: "COD charge not found or inactive",
      });
    return res.json({ success: true, data: charge });
  } catch (err) {
    logger.error("getCODCharge error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};


// ✅ Get Additional charge
exports.getAdditionalCharge = async (req, res) => {
  try {
    const charge = await Charge.getChargeByType("ADDITIONAL");
    if (!charge)
      return res.status(404).json({
        success: false,
        message: "Additional charge not found or inactive",
      });
    return res.json({ success: true, data: charge });
  } catch (err) {
    logger.error("getAdditionalCharge error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};


// ✅ Create charge (only if not exists)
exports.createCharge = async (req, res) => {
  try {
    const { charge_name, amount, charge_type = "FLAT", is_active = 1 } = req.body;
    if (!charge_name || !amount)
      return res.status(400).json({ success: false, message: "charge_name and amount required" });

    const existing = await Charge.getChargeByType(charge_name);
    if (existing)
      return res.status(400).json({
        success: false,
        message: "Charge already exists, please update it instead.",
      });

    const charge = await Charge.createCharge({ charge_name, amount, charge_type, is_active });
    return res.status(201).json({ success: true, message: "Charge created successfully", data: charge });
  } catch (err) {
    logger.error("createCharge error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ Update charge
exports.updateCharge = async (req, res) => {
  try {
    const { charge_name } = req.params;
    const { amount, charge_type = "FLAT", is_active = 1 } = req.body;

    const existing = await Charge.getChargeByType(charge_name);
    if (!existing)
      return res.status(404).json({ success: false, message: "Charge not found" });

    await Charge.updateCharge(charge_name, { amount, charge_type, is_active });
    return res.json({ success: true, message: "Charge updated successfully" });
  } catch (err) {
    logger.error("updateCharge error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Delete charge
exports.deleteCharge = async (req, res) => {
  try {
    const { charge_name } = req.params;
    const deleted = await Charge.deleteCharge(charge_name);
    if (!deleted)
      return res.status(404).json({ success: false, message: "Charge not found" });

    return res.json({ success: true, message: "Charge deleted successfully" });
  } catch (err) {
    logger.error("deleteCharge error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Toggle charge active/inactive
exports.toggleCharge = async (req, res) => {
  try {
    const { charge_name } = req.params;
    const result = await Charge.toggleChargeStatus(charge_name);

    if (!result)
      return res.status(404).json({ success: false, message: "Charge not found" });

    return res.json({
      success: true,
      message: `Charge ${result.newStatus ? "activated" : "deactivated"} successfully.`,
      new_status: result.newStatus,
    });
  } catch (err) {
    logger.error("toggleCharge error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
