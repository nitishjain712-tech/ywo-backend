const logger = require('../utils/logger');

// Centralized error handler
function errorHandler(err, req, res, next) {
  logger.error("🔥 Error: " + err.message, { stack: err.stack, method: req.method, url: req.url });

  // ✅ Multer upload errors
  if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "File size too large (max 2MB)" });
    }
    return res.status(400).json({ message: "File upload error", error: err.message });
  }

  // ✅ Custom errors from middleware
  if (err.message && err.message.includes("Only images")) {
    return res.status(400).json({ message: err.message });
  }

  // ✅ Generic server error
  res.status(500).json({
    message: "Something went wrong",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
}

module.exports = errorHandler;
