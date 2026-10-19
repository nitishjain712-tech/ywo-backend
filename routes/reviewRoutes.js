const express = require("express");
const authenticate = require("../middlewares/authenticate");
const adminAuth = require("../middlewares/adminAuth");
const authorize = require("../middlewares/authorize");
const reviewController = require("../controllers/reviewController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

router.post("/", authenticate, asyncHandler(reviewController.createReview));
router.put("/:id", authenticate, asyncHandler(reviewController.updateReview));
router.delete("/:id", authenticate, asyncHandler(reviewController.deleteReview));

router.delete(
  "/:id/permanent",
  adminAuth,
  asyncHandler(reviewController.deleteReviewPermanentlyById)
);
router.patch(
  "/:id/restore",
  adminAuth,
  authorize("super_admin", "admin"),
  asyncHandler(reviewController.restoreReview)
);

router.get(
  "/product/:product_id",
  asyncHandler(reviewController.getProductReviews)
);
router.get(
  "/product/:product_id/all",
  adminAuth,
  asyncHandler(reviewController.getReviewsByProductId)
);
router.get(
  "/user/:user_id",
  asyncHandler(reviewController.getUserReviews)
);
router.get("/verified", asyncHandler(reviewController.getAllVerifiedReviews));

module.exports = router;


