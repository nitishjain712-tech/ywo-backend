const logger = require("../utils/logger");
const PrivacyPolicy = require("../models/privacyPolicyModel");

exports.createPolicy = async (req, res) => {
  try {
    const { title, content, is_active } = req.body;
    if (!title || !content)
      return res.status(400).json({ message: "Title and content are required" });

    const id = await PrivacyPolicy.create({ title, content, is_active });
    return res.status(201).json({ message: "Privacy policy created successfully", id });
  } catch (err) {
    logger.error("❌ Error creating privacy policy:", err);
    res.status(500).json({ message: "Error creating privacy policy" });
  }
};

exports.getAllPolicies = async (req, res) => {
  try {
    const policies = await PrivacyPolicy.getAll();
    return res.json({ message: "Privacy policies fetched successfully", policies });
  } catch (err) {
    logger.error("❌ Error fetching privacy policies:", err);
    res.status(500).json({ message: "Error fetching privacy policies" });
  }
};

exports.getAllActivePolicies = async (req, res) => {
  try {
    const policies = await PrivacyPolicy.getAllActivePolicies();
    return res.json({ message: "Privacy policies fetched successfully", policies });
  } catch (err) {
    logger.error("❌ Error fetching privacy policies:", err);
    res.status(500).json({ message: "Error fetching privacy policies" });
  }
};

exports.getPolicyById = async (req, res) => {
  try {
    const { id } = req.params;
    const policy = await PrivacyPolicy.getById(id);
    if (!policy) return res.status(404).json({ message: "Privacy policy not found" });
    return res.json({ message: "Privacy policy fetched successfully", policy });
  } catch (err) {
    logger.error("❌ Error fetching privacy policy:", err);
    res.status(500).json({ message: "Error fetching privacy policy" });
  }
};

exports.updatePolicy = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, is_active } = req.body;
    const success = await PrivacyPolicy.update(id, { title, content, is_active });
    if (!success) return res.status(404).json({ message: "Privacy policy not found" });
    return res.json({ message: "Privacy policy updated successfully" });
  } catch (err) {
    logger.error("❌ Error updating privacy policy:", err);
    res.status(500).json({ message: "Error updating privacy policy" });
  }
};

exports.deletePolicy = async (req, res) => {
  try {
    const { id } = req.params;
    const success = await PrivacyPolicy.delete(id);
    if (!success) return res.status(404).json({ message: "Privacy policy not found" });
    return res.json({ message: "Privacy policy deleted successfully" });
  } catch (err) {
    logger.error("❌ Error deleting privacy policy:", err);
    res.status(500).json({ message: "Error deleting privacy policy" });
  }
};
