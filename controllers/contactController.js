const logger = require("../utils/logger");
const Contact = require("../models/contactModel");

// 📧 Public: Submit Contact Inquiry
exports.submitContact = async (req, res) => {
  try {
    const { name, email, phone, subject, category, message } = req.body;

    // Basic Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ success: false, message: "Please provide a valid email address" });
    }

    if (!subject || !subject.trim()) {
      return res.status(400).json({ success: false, message: "Subject is required" });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }

    if (message.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: "Message must be at least 10 characters long",
      });
    }

    // IP & User Agent
    const clientIp =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      req.ip ||
      null;

    const userAgent = req.headers["user-agent"]
      ? req.headers["user-agent"].substring(0, 255)
      : null;

    const sanitizedCategory = category && category.trim() ? category.trim() : "General";

    const inquiryId = await Contact.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone ? phone.trim() : null,
      subject: subject.trim(),
      category: sanitizedCategory,
      message: message.trim(),
      ip_address: clientIp,
      user_agent: userAgent,
    });

    logger.info(`📬 New contact inquiry #${inquiryId} submitted by ${email.trim()}`);

    return res.status(201).json({
      success: true,
      message:
        "Thank you for contacting Yuva Western Outfit! Your inquiry has been received, and our team will get back to you shortly.",
      inquiryId,
    });
  } catch (err) {
    logger.error("❌ Error submitting contact inquiry:", err);
    return res.status(500).json({
      success: false,
      message: "An error occurred while submitting your message. Please try again or reach out via WhatsApp.",
    });
  }
};

// 📋 Admin: Get All Contact Inquiries
exports.getAllContacts = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const data = await Contact.getAll({ status, page, limit });
    return res.json({ success: true, ...data });
  } catch (err) {
    logger.error("❌ Error fetching contact inquiries:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch contact inquiries" });
  }
};

// 🔍 Admin: Get Single Contact Inquiry
exports.getContactById = async (req, res) => {
  try {
    const { id } = req.params;
    const inquiry = await Contact.getById(id);
    if (!inquiry) {
      return res.status(404).json({ success: false, message: "Contact inquiry not found" });
    }
    return res.json({ success: true, inquiry });
  } catch (err) {
    logger.error("❌ Error fetching contact inquiry:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch contact inquiry" });
  }
};

// ✏️ Admin: Update Contact Inquiry Status
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ["new", "in_progress", "resolved", "closed"];
    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed values are: ${allowedStatuses.join(", ")}`,
      });
    }

    const updated = await Contact.updateStatus(id, status);
    if (!updated) {
      return res.status(404).json({ success: false, message: "Contact inquiry not found" });
    }

    return res.json({ success: true, message: `Inquiry status updated to ${status}` });
  } catch (err) {
    logger.error("❌ Error updating contact status:", err);
    return res.status(500).json({ success: false, message: "Failed to update inquiry status" });
  }
};

// ❌ Admin: Delete Contact Inquiry
exports.deleteContact = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Contact.delete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Contact inquiry not found" });
    }
    return res.json({ success: true, message: "Contact inquiry deleted successfully" });
  } catch (err) {
    logger.error("❌ Error deleting contact inquiry:", err);
    return res.status(500).json({ success: false, message: "Failed to delete contact inquiry" });
  }
};
