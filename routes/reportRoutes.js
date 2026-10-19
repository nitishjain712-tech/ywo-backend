const express = require("express");
const router = express.Router();
const { downloadSalesReport } = require("../controllers/reportController");
const adminAuth = require("../middlewares/adminAuth");

router.get("/sales-report", adminAuth, downloadSalesReport);

module.exports = router;
