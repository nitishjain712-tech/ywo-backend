const express = require("express");
const adminAuth = require("../middlewares/adminAuth");
const dealController = require("../controllers/dealController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

router.get("/", asyncHandler(dealController.getDeals));
router.get("/active", asyncHandler(dealController.getActiveDeals));
// Get active deal by product id (Frontend)
router.get(
  "/active/product/:productId",
  asyncHandler(dealController.getActiveDealByProduct)
);

// Variant-wise active deal
router.get(
  "/active/variant/:variantId",
  asyncHandler(dealController.getActiveDealByVariant)
);


router.get("/:id", asyncHandler(dealController.getDealById));

router.post("/", adminAuth, asyncHandler(dealController.createDeal));
router.put("/:id", adminAuth, asyncHandler(dealController.updateDeal));
router.delete("/:id", adminAuth, asyncHandler(dealController.deleteDeal));

module.exports = router;


