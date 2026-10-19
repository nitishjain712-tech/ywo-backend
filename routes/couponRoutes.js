const express = require("express");
const adminAuth = require("../middlewares/adminAuth");
const couponController = require("../controllers/couponController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// Public/user endpoints
router.post(
  "/validate",
  asyncHandler(couponController.validateCoupon)
);
router.post(
  "/apply",
  asyncHandler(couponController.applyCoupon)
);
router.post(
  "/valid/product",
  asyncHandler(couponController.getValidCouponsForProduct)
);
router.post(
  "/valid/cart",
  asyncHandler(couponController.getValidCouponsForCart)
);

// Admin endpoints
router.get(
  "/inactive",
  adminAuth,
  asyncHandler(couponController.getNotActiveCoupons)
);

router.get(
  "/active",
  adminAuth,
  asyncHandler(couponController.getNotActiveCoupons)
);

router.get(
  "/product/:productId",
  adminAuth,
  asyncHandler(couponController.getCouponsForProduct)
);
router.get(
  "/category/:categoryId",
  adminAuth,
  asyncHandler(couponController.getCouponsForCategory)
);
router.get("/", adminAuth, asyncHandler(couponController.getCoupons));
router.get("/:id", adminAuth, asyncHandler(couponController.getCouponById));
router.post("/", adminAuth, asyncHandler(couponController.createCoupon));
router.put("/:id", adminAuth, asyncHandler(couponController.updateCoupon));
router.patch(
  "/:id/toggle",
  adminAuth,
  asyncHandler(couponController.toggleCoupon)
);
router.delete("/:id", adminAuth, asyncHandler(couponController.deleteCoupon));
router.patch(
  "/:id/restore",
  adminAuth,
  asyncHandler(couponController.restoreCoupon)
);

module.exports = router;

