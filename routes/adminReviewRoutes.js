const express = require("express");
const adminAuth = require("../middlewares/adminAuth");
const authorize = require("../middlewares/authorize");
const adminReviewController = require("../controllers/adminReviewController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

const requireAdmin = [adminAuth, authorize("super_admin", "admin")];

router.post(
  "/",
  ...requireAdmin,
  asyncHandler(adminReviewController.createFakeReview)
);
router.patch(
  "/:id/verify",
  ...requireAdmin,
  asyncHandler(adminReviewController.verifyReview)
);
router.patch(
  "/:id/reject",
  ...requireAdmin,
  asyncHandler(adminReviewController.rejectReview)
);
router.delete(
  "/:id",
  ...requireAdmin,
  asyncHandler(adminReviewController.deleteAdminReviewSoftly)
);
router.delete(
  "/:id/permanent",
  ...requireAdmin,
  asyncHandler(adminReviewController.deleteReviewPermanentlyById)
);
router.get(
  "/product/:product_id",
  adminAuth,
  asyncHandler(adminReviewController.getProductReviews)
);
router.get(
  "/pending",
  ...requireAdmin,
  asyncHandler(adminReviewController.getAllPendingReviews)
);
router.get(
  "/rejected",
  ...requireAdmin,
  asyncHandler(adminReviewController.getAllRejectedReviews)
);
router.get(
  "/verified",
  adminAuth,
  asyncHandler(adminReviewController.getAllVerifiedReviews)
);
router.get(
  "/deleted",
  ...requireAdmin,
  asyncHandler(adminReviewController.getSoftlyDeletedReviews)
);
router.get(
  "/all",
  adminAuth,
  asyncHandler(adminReviewController.getAllAdminReviews)
);

module.exports = router;


