const express = require("express");
const router = express.Router();

const CodSettingsController = require(
  "../controllers/codSettingsController"
);
const adminAuth = require("../middlewares/adminAuth");

// ======================
// Admin Routes
// ======================

// Get all COD settings
router.get("/", adminAuth, CodSettingsController.getAll);

// Create COD settings (only one allowed)
router.post("/", adminAuth, CodSettingsController.create);

// Update COD settings
router.put("/:id", adminAuth, CodSettingsController.update);

// Delete COD settings
router.delete("/:id", adminAuth, CodSettingsController.delete);

// ======================
// Public Route (used in checkout / previewOrder)
// ======================

// Get active COD settings
router.get("/active", CodSettingsController.getActive);

module.exports = router;
