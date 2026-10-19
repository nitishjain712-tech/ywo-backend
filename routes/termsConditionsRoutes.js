const express = require("express");
const adminAuth = require("../middlewares/adminAuth");
const termsConditionsController = require("../controllers/termsConditionsController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

router.get("/", asyncHandler(termsConditionsController.getAllTerms));
router.get(
  "/active",
  asyncHandler(termsConditionsController.getAllActiveTerms)
);
router.get(
  "/:id",
  asyncHandler(termsConditionsController.getTermsById)
);
router.post(
  "/",
  adminAuth,
  asyncHandler(termsConditionsController.createTerms)
);
router.put(
  "/:id",
  adminAuth,
  asyncHandler(termsConditionsController.updateTerms)
);
router.delete(
  "/:id",
  adminAuth,
  asyncHandler(termsConditionsController.deleteTerms)
);

module.exports = router;


