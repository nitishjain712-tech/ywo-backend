const express = require("express");
const adminAuth = require("../middlewares/adminAuth");
const faqController = require("../controllers/faqController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

router.get("/", asyncHandler(faqController.getAllFAQs));
router.get("/active", asyncHandler(faqController.getAllActiveFAQs));
router.get("/:id", asyncHandler(faqController.getFAQById));
router.post("/", adminAuth, asyncHandler(faqController.createFAQ));
router.put("/:id", adminAuth, asyncHandler(faqController.updateFAQ));
router.delete("/:id", adminAuth, asyncHandler(faqController.deleteFAQ));

module.exports = router;


