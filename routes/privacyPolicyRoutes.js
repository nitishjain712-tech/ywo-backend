const express = require("express");
const adminAuth = require("../middlewares/adminAuth");
const privacyPolicyController = require("../controllers/privacyPolicyController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

router.get("/", asyncHandler(privacyPolicyController.getAllPolicies));
router.get(
  "/active",
  asyncHandler(privacyPolicyController.getAllActivePolicies)
);
router.get(
  "/:id",
  asyncHandler(privacyPolicyController.getPolicyById)
);
router.post(
  "/",
  adminAuth,
  asyncHandler(privacyPolicyController.createPolicy)
);
router.put(
  "/:id",
  adminAuth,
  asyncHandler(privacyPolicyController.updatePolicy)
);
router.delete(
  "/:id",
  adminAuth,
  asyncHandler(privacyPolicyController.deletePolicy)
);

module.exports = router;


