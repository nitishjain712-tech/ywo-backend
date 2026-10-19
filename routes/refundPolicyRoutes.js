const express = require("express");
const adminAuth = require("../middlewares/adminAuth");
const refundPolicyController = require("../controllers/refundPolicyController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

router.get(
  "/",
  asyncHandler(refundPolicyController.getAllRefundPolicies)
);
router.get(
  "/get-active-refund-policy",
  asyncHandler(refundPolicyController.getAllActiveRefundPolicies)
);
router.get(
  "/:id",
  asyncHandler(refundPolicyController.getRefundPolicyById)
);
router.post(
  "/",
  adminAuth,
  asyncHandler(refundPolicyController.createRefundPolicy)
);
router.put(
  "/:id",
  adminAuth,
  asyncHandler(refundPolicyController.updateRefundPolicy)
);
router.delete(
  "/:id",
  adminAuth,
  asyncHandler(refundPolicyController.deleteRefundPolicy)
);

module.exports = router;


