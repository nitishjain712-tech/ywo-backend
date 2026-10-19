const express = require("express");
const authenticate = require("../middlewares/authenticate");
const invoiceController = require("../controllers/invoiceController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

router.post(
  "/generate",
  authenticate,
  asyncHandler(invoiceController.generateInvoice)
);

module.exports = router;


