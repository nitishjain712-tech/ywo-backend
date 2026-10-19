const express = require("express");
const authenticate = require("../middlewares/authenticate");
const adminAuth = require("../middlewares/adminAuth");
const paymentController = require("../controllers/paymentController");

const router = express.Router();

// Wrapper to handle async errors
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// If admin token exists, attach admin flag to req.user
const ensureAdminUserFlag = (req, res, next) => {
  if (req.admin) {
    req.user = {
      ...(req.user || {}),
      id: req.admin.id,
      isAdmin: true,
    };
  }
  next();
};





/* =========================================================
   🔹 CUSTOMER PAYMENT ROUTES
========================================================= */

// Initiate payment for existing PENDING order
router.post(
  "/initiate",
  authenticate,
  asyncHandler(paymentController.initiatePayment)
);

// Razorpay frontend verification
router.post(
  "/verify",
  authenticate,
  asyncHandler(paymentController.verifyPayment)
);

// Get order payment status (for customer)
router.get(
  "/order/:orderId",
  authenticate,
  asyncHandler(paymentController.getStatus)
);





/* =========================================================
   🔹 GATEWAY CALLBACKS
========================================================= */

// PhonePe callback (if gateway switched back)
router.post(
  "/callback",
  asyncHandler(paymentController.callback)
);

// Razorpay webhook
router.post(
  "/webhook",
  asyncHandler(paymentController.webhook)
);





/* =========================================================
   🔹 ADMIN PAYMENT ROUTES
========================================================= */

// Get all payments (simple list)
router.get(
  "/",
  adminAuth,
  asyncHandler(paymentController.getAllPayments)
);

// Advanced filter list
router.get(
  "/list",
  adminAuth,
  asyncHandler(paymentController.adminListPayments)
);

// Manually update COD payment status
router.post(
  "/cod/update-status",
  adminAuth,
  asyncHandler(paymentController.updateCODPaymentStatus)
);

// Admin refund (manual DB refund only)
router.post(
  "/order/:orderId/refund",
  adminAuth,
  ensureAdminUserFlag,
  asyncHandler(paymentController.adminRefund)
);

// Admin check payment status (PhonePe fallback)
router.get(
  "/status/:merchantOrderId",
  adminAuth,
  asyncHandler(paymentController.checkStatus)
);

// Admin force refresh status (PhonePe flow)
router.get(
  "/status/:merchantOrderId/refresh",
  adminAuth,
  asyncHandler(paymentController.checkAndUpdateStatus)
);

module.exports = router;