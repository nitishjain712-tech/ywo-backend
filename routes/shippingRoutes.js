const express = require("express");
const shippingController = require("../controllers/shippingController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

router.post(
  "/calculate",
  asyncHandler(shippingController.calculateShipping)
);

module.exports = router;


