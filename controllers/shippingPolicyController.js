const logger = require("../utils/logger");
const ShippingPolicy = require("../models/shippingPolicyModel");

exports.createPolicy = async (req, res) => {
  try {
    const { title, content, is_active } = req.body;
    if (!title || !content)
      return res.status(400).json({ message: "Title and content are required" });

    const id = await ShippingPolicy.create({ title, content, is_active });
    return res.status(201).json({ message: "Shipping policy created successfully", id });
  } catch (err) {
    logger.error("❌ Error creating shipping policy:", err);
    res.status(500).json({ message: "Error creating shipping policy" });
  }
};

exports.getAllPolicies = async (req, res) => {
  try {
    const policies = await ShippingPolicy.getAll();
    return res.json({ message: "Shipping policies fetched successfully", policies });
  } catch (err) {
    logger.error("❌ Error fetching shipping policies:", err);
    res.status(500).json({ message: "Error fetching shipping policies" });
  }
};

exports.getPolicyById = async (req, res) => {
  try {
    const { id } = req.params;
    const policy = await ShippingPolicy.getById(id);
    if (!policy) return res.status(404).json({ message: "Shipping policy not found" });
    return res.json({ message: "Shipping policy fetched successfully", policy });
  } catch (err) {
    logger.error("❌ Error fetching shipping policy:", err);
    res.status(500).json({ message: "Error fetching shipping policy" });
  }
};

exports.updatePolicy = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, is_active } = req.body;
    const success = await ShippingPolicy.update(id, { title, content, is_active });
    if (!success) return res.status(404).json({ message: "Shipping policy not found" });
    return res.json({ message: "Shipping policy updated successfully" });
  } catch (err) {
    logger.error("❌ Error updating shipping policy:", err);
    res.status(500).json({ message: "Error updating shipping policy" });
  }
};

exports.deletePolicy = async (req, res) => {
  try {
    const { id } = req.params;
    const success = await ShippingPolicy.delete(id);
    if (!success) return res.status(404).json({ message: "Shipping policy not found" });
    return res.json({ message: "Shipping policy deleted successfully" });
  } catch (err) {
    logger.error("❌ Error deleting shipping policy:", err);
    res.status(500).json({ message: "Error deleting shipping policy" });
  }
};
