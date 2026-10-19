const express = require("express");
const adminAuth = require("../middlewares/adminAuth");
const authorize = require("../middlewares/authorize");
const chargeController = require("../controllers/chargeController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

router.get("/", asyncHandler(chargeController.getAllCharges));
router.get("/cod", asyncHandler(chargeController.getCODCharge));
router.get(
  "/additional",
  asyncHandler(chargeController.getAdditionalCharge)
);

const adminOnly = [adminAuth, authorize("super_admin", "admin")];

router.post(
  "/",
  ...adminOnly,
  asyncHandler(chargeController.createCharge)
);
router.put(
  "/:charge_name",
  ...adminOnly,
  asyncHandler(chargeController.updateCharge)
);
router.patch(
  "/:charge_name/toggle",
  ...adminOnly,
  asyncHandler(chargeController.toggleCharge)
);
router.delete(
  "/:charge_name",
  ...adminOnly,
  asyncHandler(chargeController.deleteCharge)
);

module.exports = router;


