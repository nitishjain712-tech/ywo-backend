const express = require("express");
const authController = require("../controllers/authController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// ── Signup with email OTP verification (production flow) ──────────────
router.post("/signup/send-otp",    asyncHandler(authController.sendSignupOtp));
router.post("/signup/verify-otp",  asyncHandler(authController.verifySignupOtp));
router.post("/signup/resend-otp",  asyncHandler(authController.resendSignupOtp));

// ── Legacy signup (kept for internal/admin use) ───────────────────────
router.post("/signup",             asyncHandler(authController.signup));

// ── Auth ──────────────────────────────────────────────────────────────
router.post("/login",              asyncHandler(authController.login));
router.post("/logout",             asyncHandler(authController.logout));
router.post("/refresh",            asyncHandler(authController.refreshToken));

// ── Password reset ────────────────────────────────────────────────────
router.post("/forgot-password",    asyncHandler(authController.forgotPassword));
router.post("/verify-otp",         asyncHandler(authController.verifyOtp));
router.post("/reset-password",     asyncHandler(authController.resetPassword));

module.exports = router;
