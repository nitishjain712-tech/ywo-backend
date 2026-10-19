const express = require("express");
const adminAuth = require("../middlewares/adminAuth");
const shippingPolicyController = require("../controllers/shippingPolicyController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

router.get("/", asyncHandler(shippingPolicyController.getAllPolicies));
router.get(
  "/:id",
  asyncHandler(shippingPolicyController.getPolicyById)
);
router.post(
  "/",
  adminAuth,
  asyncHandler(shippingPolicyController.createPolicy)
);
router.put(
  "/:id",
  adminAuth,
  asyncHandler(shippingPolicyController.updatePolicy)
);
router.delete(
  "/:id",
  adminAuth,
  asyncHandler(shippingPolicyController.deletePolicy)
);

module.exports = router;


