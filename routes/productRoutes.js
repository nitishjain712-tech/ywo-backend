const express = require("express");
const adminAuth = require("../middlewares/adminAuth");
const { uploadProductMedia } = require("../middlewares/uploadProductMedia");
const productController = require("../controllers/productController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

router.get("/filter", asyncHandler(productController.getFilteredProducts));
router.get("/search", asyncHandler(productController.searchProducts));
router.get("/suggestions", asyncHandler(productController.searchSuggestions));
router.get("/names", adminAuth, asyncHandler(productController.getProductsNameAndId));
router.get("/all", asyncHandler(productController.getAllProductsFull));
router.post("/orders/check-cod-availability", asyncHandler(productController.checkCodAvailability));
// 🚀 NEW BULK STOCK UPDATE ROUTE (correct position)
router.put(
  "/variants/update-stock-bulk",
  adminAuth,
  asyncHandler(productController.updateStockBulk)
);
router.get("/media/:id", asyncHandler(productController.getProductMediaByProductId));
router.get("/variants", asyncHandler(productController.getAllVariants));
router.get("/variants/:variantId", adminAuth, asyncHandler(productController.getVariant));
router.post(
  "/:productId/variants",
  adminAuth,
  asyncHandler(productController.createVariant)
);
router.put(
  "/variants/:id",
  adminAuth,
  asyncHandler(productController.updateVariant)
);


router.delete(
  "/variants/:id",
  adminAuth,
  asyncHandler(productController.deleteVariant)
);

router.post(
  "/",
  adminAuth,
  uploadProductMedia,
  asyncHandler(productController.createProduct)
);
router.put(
  "/:id",
  adminAuth,
  uploadProductMedia,
  asyncHandler(productController.updateProduct)
);
router.delete(
  "/media/:id",
  adminAuth,
  asyncHandler(productController.deleteMedia)
);
router.delete("/:id", adminAuth, asyncHandler(productController.deleteProduct));
router.get("/:id", asyncHandler(productController.getProductById));
router.post(
  "/editor/upload-image/:productId",
  productController.uploadEditorImage
);


module.exports = router;


