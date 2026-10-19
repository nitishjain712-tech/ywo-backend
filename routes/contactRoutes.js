const express = require("express");
const rateLimit = require("express-rate-limit");
const adminAuth = require("../middlewares/adminAuth");
const contactController = require("../controllers/contactController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// Rate limiter for contact submissions to prevent spam bots (10 messages per 15 min per IP)
const contactSubmissionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "Too many inquiries sent from this device. Please wait a few minutes before trying again or reach out directly on WhatsApp.",
  },
});

// 📬 Public route: Submit contact inquiry
router.post("/", contactSubmissionLimiter, asyncHandler(contactController.submitContact));

// 🔒 Admin routes: Manage contact inquiries
router.get("/", adminAuth, asyncHandler(contactController.getAllContacts));
router.get("/:id", adminAuth, asyncHandler(contactController.getContactById));
router.patch("/:id/status", adminAuth, asyncHandler(contactController.updateStatus));
router.delete("/:id", adminAuth, asyncHandler(contactController.deleteContact));

module.exports = router;
