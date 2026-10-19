const express = require("express");
const router = express.Router();
const EstimatedDeliveryDateController = require("../controllers/estimatedDeliveryDateController");
const adminAuth = require("../middlewares/adminAuth");
// Get all
router.get("/", adminAuth, EstimatedDeliveryDateController.getAll);

router.get("/latest", EstimatedDeliveryDateController.getLatest);


// Get one
router.get("/:id", adminAuth, EstimatedDeliveryDateController.getOne);

// Create
router.post("/", adminAuth, EstimatedDeliveryDateController.create);

// Update
router.put("/:id", adminAuth, EstimatedDeliveryDateController.update);

// Delete
router.delete("/:id", adminAuth, EstimatedDeliveryDateController.delete);



module.exports = router;
