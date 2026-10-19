const logger = require("../utils/logger");
const FAQ = require("../models/faqModel");

// ➕ Create FAQ
exports.createFAQ = async (req, res) => {
  try {
    const { question, answer, is_active } = req.body;
    if (!question || !answer)
      return res.status(400).json({ message: "Question and answer are required" });

    const id = await FAQ.create({ question, answer, is_active });
    return res.status(201).json({ message: "FAQ created successfully", id });
  } catch (err) {
    logger.error("❌ Error creating FAQ:", err);
    res.status(500).json({ message: "Error creating FAQ" });
  }
};

// 📋 Get all FAQs
exports.getAllFAQs = async (req, res) => {
  try {
    const faqs = await FAQ.getAll();
    return res.json({ message: "FAQs fetched successfully", faqs });
  } catch (err) {
    logger.error("❌ Error fetching FAQs:", err);
    res.status(500).json({ message: "Error fetching FAQs" });
  }
};

exports.getAllActiveFAQs = async (req, res) => {
  try {
    const faqs = await FAQ.getAllActiveFAQs();
    return res.json({ message: "FAQs fetched successfully", faqs });
  } catch (err) {
    logger.error("❌ Error fetching FAQs:", err);
    res.status(500).json({ message: "Error fetching FAQs" });
  }
};

// 🔍 Get single FAQ
exports.getFAQById = async (req, res) => {
  try {
    const { id } = req.params;
    const faq = await FAQ.getById(id);
    if (!faq) return res.status(404).json({ message: "FAQ not found" });
    return res.json({ message: "FAQ fetched successfully", faq });
  } catch (err) {
    logger.error("❌ Error fetching FAQ:", err);
    res.status(500).json({ message: "Error fetching FAQ" });
  }
};

// ✏️ Update FAQ
exports.updateFAQ = async (req, res) => {
  try {
    const { id } = req.params;
    const { question, answer, is_active } = req.body;
    const success = await FAQ.update(id, { question, answer, is_active });
    if (!success) return res.status(404).json({ message: "FAQ not found" });
    return res.json({ message: "FAQ updated successfully" });
  } catch (err) {
    logger.error("❌ Error updating FAQ:", err);
    res.status(500).json({ message: "Error updating FAQ" });
  }
};

// ❌ Delete FAQ
exports.deleteFAQ = async (req, res) => {
  try {
    const { id } = req.params;
    const success = await FAQ.delete(id);
    if (!success) return res.status(404).json({ message: "FAQ not found" });
    return res.json({ message: "FAQ deleted successfully" });
  } catch (err) {
    logger.error("❌ Error deleting FAQ:", err);
    res.status(500).json({ message: "Error deleting FAQ" });
  }
};
