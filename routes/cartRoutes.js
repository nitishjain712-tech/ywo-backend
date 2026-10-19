const express = require("express");
const authenticate = require("../middlewares/authenticate");
const cartController = require("../controllers/cartController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

router.post("/", authenticate, asyncHandler(cartController.addToCart));
router.get("/", authenticate, asyncHandler(cartController.getCart));
router.put("/", authenticate, asyncHandler(cartController.updateCartItem));
router.delete(
  "/:cart_item_id",
  authenticate,
  asyncHandler(cartController.removeCartItem)
);
router.delete("/", authenticate, asyncHandler(cartController.clearCart));

module.exports = router;


