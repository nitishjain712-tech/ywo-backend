// src/utils/logger.js
const { createLogger, format, transports } = require("winston");
const path = require("path");

const logFormat = format.printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info", // 'info' | 'debug' | 'error' | 'warn'
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    format.splat(),
    logFormat
  ),
  transports: [
    // ✅ Log to console (for dev)
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.timestamp({ format: "HH:mm:ss" }),
        format.simple()
      ),
    }),

    // ✅ Save all logs to file
    new transports.File({
      filename: path.join(__dirname, "../../logs/combined.log"),
      maxsize: 5 * 1024 * 1024, // 5 MB
      maxFiles: 5,
    }),

    // ✅ Save only errors separately
    new transports.File({
      filename: path.join(__dirname, "../../logs/error.log"),
      level: "error",
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});

// ✅ If running in dev, log unhandled rejections too
process.on("unhandledRejection", (err) => {
  logger.error("Unhandled Rejection:", err);
});
process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", err);
});

module.exports = logger;
