const logger = require("../utils/logger");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
require("dotenv").config();

const adminAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Authorization token missing" });
    }

    const token = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET); // will throw if expired
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ success: false, message: "Access token expired" });
      }
      return res.status(403).json({ success: false, message: "Invalid access token" });
    }

    // Fetch admin from DB and check active status
    const [rows] = await pool.query(
      "SELECT id, name, email, role, status FROM admin WHERE id = ? LIMIT 1",
      [decoded.id]
    );

    if (!rows.length) return res.status(404).json({ success: false, message: "Admin not found" });
    const admin = rows[0];
    if (admin.status !== "active") return res.status(403).json({ success: false, message: "Admin is deactivated" });

    req.admin = { ...admin };
    next();
  } catch (err) {
    logger.error("Auth middleware error:", err);
    res.status(500).json({ success: false, message: "Authorization failed" });
  }
};

module.exports = adminAuth;
