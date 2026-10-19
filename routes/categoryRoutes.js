const express = require("express");
const adminAuth = require("../middlewares/adminAuth");
const uploadCategoryImage = require("../middlewares/uploadCategoryImage");
const categoryController = require("../controllers/categoryController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

router.get("/", asyncHandler(categoryController.getCategories));
router.get(
  "/deleted",
  adminAuth,
  asyncHandler(categoryController.getDeletedCategories)
);
router.get("/:id", asyncHandler(categoryController.getCategoryById));

router.post(
  "/",
  adminAuth,
  uploadCategoryImage,
  asyncHandler(categoryController.createCategory)
);
router.put(
  "/:id",
  adminAuth,
  uploadCategoryImage,
  asyncHandler(categoryController.updateCategory)
);
router.delete(
  "/:id",
  adminAuth,
  asyncHandler(categoryController.deleteCategory)
);
router.patch(
  "/:id/restore",
  adminAuth,
  asyncHandler(categoryController.restoreCategory)
);

module.exports = router;


