const logger = require("../utils/logger");
// middleware/authorize.js
module.exports = function authorize(...allowedRoles) {
  return (req, res, next) => {
    try {
      const admin = req.admin; // populated from adminAuth middleware

      if (!admin) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      // Check if admin role is allowed
      if (!allowedRoles.includes(admin.role)) {
        return res.status(403).json({
          success: false,
          message: "Access denied: insufficient permissions",
        });
      }

      next();
    } catch (err) {
      logger.error("Authorization error:", err);
      return res.status(500).json({ success: false, message: "Authorization failed" });
    }
  };
};
