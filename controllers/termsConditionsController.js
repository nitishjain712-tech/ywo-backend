const logger = require("../utils/logger");
const TermsConditions = require("../models/termsConditionsModel");

exports.createTerms = async (req, res) => {
  try {
    const { title, content, is_active } = req.body;
    if (!title || !content)
      return res.status(400).json({ message: "Title and content are required" });

    const id = await TermsConditions.create({ title, content, is_active });
    return res.status(201).json({ message: "Terms & Conditions created successfully", id });
  } catch (err) {
    logger.error("❌ Error creating terms & conditions:", err);
    res.status(500).json({ message: "Error creating terms & conditions" });
  }
};

exports.getAllTerms = async (req, res) => {
  try {
    const terms = await TermsConditions.getAll();
    return res.json({ message: "Terms & Conditions fetched successfully", terms });
  } catch (err) {
    logger.error("❌ Error fetching terms & conditions:", err);
    res.status(500).json({ message: "Error fetching terms & conditions" });
  }
};

exports.getAllActiveTerms = async (req, res) => {
  try {
    const terms = await TermsConditions.getAllActive();
    return res.json({ message: "Terms & Conditions fetched successfully", terms });
  } catch (err) {
    logger.error("❌ Error fetching terms & conditions:", err);
    res.status(500).json({ message: "Error fetching terms & conditions" });
  }
};

exports.getTermsById = async (req, res) => {
  try {
    const { id } = req.params;
    const term = await TermsConditions.getById(id);
    if (!term) return res.status(404).json({ message: "Terms & Conditions not found" });
    return res.json({ message: "Terms & Conditions fetched successfully", term });
  } catch (err) {
    logger.error("❌ Error fetching terms & conditions:", err);
    res.status(500).json({ message: "Error fetching terms & conditions" });
  }
};

exports.updateTerms = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, is_active } = req.body;
    const success = await TermsConditions.update(id, { title, content, is_active });
    if (!success) return res.status(404).json({ message: "Terms & Conditions not found" });
    return res.json({ message: "Terms & Conditions updated successfully" });
  } catch (err) {
    logger.error("❌ Error updating terms & conditions:", err);
    res.status(500).json({ message: "Error updating terms & conditions" });
  }
};

exports.deleteTerms = async (req, res) => {
  try {
    const { id } = req.params;
    const success = await TermsConditions.delete(id);
    if (!success) return res.status(404).json({ message: "Terms & Conditions not found" });
    return res.json({ message: "Terms & Conditions deleted successfully" });
  } catch (err) {
    logger.error("❌ Error deleting terms & conditions:", err);
    res.status(500).json({ message: "Error deleting terms & conditions" });
  }
};
