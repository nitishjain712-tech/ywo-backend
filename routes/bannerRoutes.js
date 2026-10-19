const express = require("express");
const adminAuth = require("../middlewares/adminAuth");
const uploadBanner = require("../middlewares/uploadBanner");
const bannerController = require("../controllers/bannerController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

const uploadSingleBanner = uploadBanner.single("banner_image");

router.get("/", asyncHandler(bannerController.getBanners));
router.get("/active", asyncHandler(bannerController.getActiveBanners));
router.get("/:id", asyncHandler(bannerController.getBannerById));

router.post(
  "/",
  adminAuth,
  uploadSingleBanner,
  asyncHandler(bannerController.createBanner)
);
router.put(
  "/:id",
  adminAuth,
  uploadSingleBanner,
  asyncHandler(bannerController.updateBanner)
);
router.delete(
  "/:id",
  adminAuth,
  asyncHandler(bannerController.deleteBanner)
);

module.exports = router;


