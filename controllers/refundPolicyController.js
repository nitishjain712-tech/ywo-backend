const logger = require("../utils/logger");
const RefundPolicy = require("../models/refundPolicyModel");

// ➕ Create Refund Policy
exports.createRefundPolicy = async (req, res) => {
  try {
    const { title, content, is_active } = req.body;
    if (!title || !content)
      return res.status(400).json({ message: "Title and content are required" });

    const id = await RefundPolicy.create({ title, content, is_active });
    return res.status(201).json({ message: "Refund policy created", id });
  } catch (err) {
    logger.error("❌ createRefundPolicy:", err);
    return res.status(500).json({ message: "Error creating refund policy" });
  }
};

// 🔍 Get All Refund Policies
exports.getAllRefundPolicies = async (req, res) => {
  try {
    const policies = await RefundPolicy.getAll();
    return res.json({ message: "Refund policies fetched", policies });
  } catch (err) {
    logger.error("❌ getAllRefundPolicies:", err);
    return res.status(500).json({ message: "Error fetching refund policies" });
  }
};

exports.getAllActiveRefundPolicies = async (req, res) => {
  try {
    const policies = await RefundPolicy.getAllActive();
    return res.json({ message: "Refund policies fetched", policies });
  } catch (err) {
    logger.error("❌ getAllRefundPolicies:", err);
    return res.status(500).json({ message: "Error fetching refund policies" });
  }
};

// 🔍 Get Single Refund Policy
exports.getRefundPolicyById = async (req, res) => {
  try {
    const { id } = req.params;
    const policy = await RefundPolicy.getById(id);
    if (!policy) return res.status(404).json({ message: "Refund policy not found" });
    return res.json({ message: "Refund policy fetched", policy });
  } catch (err) {
    logger.error("❌ getRefundPolicyById:", err);
    return res.status(500).json({ message: "Error fetching refund policy" });
  }
};

// ✏️ Update Refund Policy
exports.updateRefundPolicy = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, is_active } = req.body;
    await RefundPolicy.update(id, { title, content, is_active });
    return res.json({ message: "Refund policy updated" });
  } catch (err) {
    logger.error("❌ updateRefundPolicy:", err);
    return res.status(500).json({ message: "Error updating refund policy" });
  }
};

// 🗑️ Delete Refund Policy
exports.deleteRefundPolicy = async (req, res) => {
  try {
    const { id } = req.params;
    await RefundPolicy.delete(id);
    return res.json({ message: "Refund policy deleted" });
  } catch (err) {
    logger.error("❌ deleteRefundPolicy:", err);
    return res.status(500).json({ message: "Error deleting refund policy" });
  }
};
