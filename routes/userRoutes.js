const express = require("express");
const authenticate = require("../middlewares/authenticate");
const adminAuth = require("../middlewares/adminAuth");
const authorize = require("../middlewares/authorize");
const userController = require("../controllers/userController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// User self-service
router.get("/profile", authenticate, asyncHandler(userController.getProfile));
router.put("/profile", authenticate, asyncHandler(userController.updateProfile));
router.put(
  "/profile/password",
  authenticate,
  asyncHandler(userController.changePassword)
);

router.put(
  "/profile/gst",
  authenticate,
  asyncHandler(userController.updateGSTNumber)
);
router.get("/profile/gst", authenticate, asyncHandler(userController.getGSTNumber));

router.post(
  "/addresses",
  authenticate,
  asyncHandler(userController.addAddress)
);
router.get(
  "/addresses",
  authenticate,
  asyncHandler(userController.getAddresses)
);
router.get(
  "/addresses/:id",
  authenticate,
  asyncHandler(userController.getAddressById)
);
router.put(
  "/addresses/:id",
  authenticate,
  asyncHandler(userController.updateAddress)
);
router.delete(
  "/addresses/:id",
  authenticate,
  asyncHandler(userController.deleteAddress)
);
router.patch(
  "/addresses/:id/default",
  authenticate,
  asyncHandler(userController.setDefaultAddress)
);

// Admin utilities
router.get(
  "/export",
  adminAuth,
  authorize("super_admin"),
  asyncHandler(userController.adminExportAllUsers)
);
router.get(
  "/with-default-address",
  adminAuth,
  asyncHandler(userController.getAllUsersWithDefaultAddress)
);
router.get(
  "/",
  adminAuth,
  asyncHandler(userController.getAllUsersWithAddresses)
);

module.exports = router;


