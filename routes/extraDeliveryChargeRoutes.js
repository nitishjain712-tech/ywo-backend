const express = require("express");
const router = express.Router();

const ExtraDeliveryChargeController = require(
  "../controllers/extraDeliveryChargeController"
);
const adminAuth = require("../middlewares/adminAuth");

// Admin
router.get("/",  adminAuth, ExtraDeliveryChargeController.getAll);
router.post("/", adminAuth, ExtraDeliveryChargeController.create);
router.put("/:id", adminAuth, ExtraDeliveryChargeController.update);
router.delete("/:id", adminAuth, ExtraDeliveryChargeController.delete);

// Public (used while checkout)
router.get("/active", ExtraDeliveryChargeController.getActive);

module.exports = router;
