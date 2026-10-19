const express = require("express");
const adminController = require("../controllers/adminController");
const userController = require("../controllers/userController");
const adminAuth = require("../middlewares/adminAuth");
const authorize = require("../middlewares/authorize");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

router.post(
  "/super-admin/setup",
  asyncHandler(adminController.createSuperAdmin)
);
router.post("/register", adminAuth, authorize("super_admin"), asyncHandler(adminController.registerAdmin));
router.post("/login", asyncHandler(adminController.login));

// ✅ OTP-Based Login Routes
router.post("/send-otp", asyncHandler(adminController.sendOTP));
router.post("/verify-otp", asyncHandler(adminController.verifyOTP));
router.post("/resend-otp", asyncHandler(adminController.resendOTP));

router.post("/logout", adminAuth, asyncHandler(adminController.logout));
router.post("/refresh", asyncHandler(adminController.refreshToken));
router.get("/profile", adminAuth, asyncHandler(adminController.getProfile));
router.get("/stats", adminAuth, asyncHandler(adminController.getDashboardStats));

router.get(
  "/",
  adminAuth,
  authorize("super_admin"),
  asyncHandler(adminController.getAllAdmins)
);

/**
 * 🔐 OTP-PROTECTED ADMIN UPDATE FLOW
 */

// Step 1: Request update (send OTP)
router.put(
  "/:id/request-update",
  adminAuth,
  authorize("super_admin"),
  asyncHandler(adminController.requestAdminUpdate)
);

// Step 2: Verify OTP & apply update
router.post(
  "/verify-update-otp",
  adminAuth,
  authorize("super_admin"),
  asyncHandler(adminController.verifyAdminUpdateOtp)
);

// Step 3: Resend OTP
router.post(
  "/resend-update-otp",
  adminAuth,
  authorize("super_admin"),
  asyncHandler(adminController.resendAdminUpdateOtp)
);

// REMOVE or COMMENT this (NO direct update allowed)
// router.put(
//   "/:id",
//   adminAuth,
//   authorize("super_admin"),
//   asyncHandler(adminController.updateAdmin)
// );

router.patch(
  "/:id/status",
  adminAuth,
  authorize("super_admin"),
  asyncHandler(adminController.changeStatus)
);

// Customer management
router.get(
  "/all-users",
  adminAuth,
  asyncHandler(userController.getAllUsersWithAllAddresses)
);

router.delete(
  "/:id",
  adminAuth,
  authorize("super_admin"),
  asyncHandler(adminController.deleteAdmin)
);


module.exports = router;


