const express = require("express");
const adminAuth = require("../middlewares/adminAuth");
const shippingLabelController = require("../controllers/shippingLabelController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

router.post(
  "/single",
  adminAuth,
  asyncHandler(shippingLabelController.generateSingleShippingLabel)
);
router.post(
  "/bulk",
  adminAuth,
  asyncHandler(shippingLabelController.generateBulkShippingLabels)
);

module.exports = router;


