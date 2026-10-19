const logger = require("../utils/logger");
/**
 * ============================================================
 * 🧹 Admin Update OTP Cleanup Cron (Production Ready)
 * ============================================================
 *
 * ✔ Deletes expired update OTPs
 * ✔ Deletes expired locks
 * ✔ Deletes verified OTPs
 * ✔ Runs once on server boot
 * ✔ Runs every 5 minutes
 * ✔ Safe & idempotent
 */

const cron = require("node-cron");
const pool = require("../config/db");

// ------------------------------------------------------------
// 🔹 One-time cleanup on server boot
// ------------------------------------------------------------
(async function runStartupCleanup() {
  try {
    const [result] = await pool.query(`
      DELETE FROM admin_update_otp
      WHERE 
        expires_at < NOW()
        OR (locked_until IS NOT NULL AND locked_until < NOW())
        OR verified_at IS NOT NULL
    `);

    logger.info(
      `[ADMIN-UPDATE-OTP-CLEANUP][BOOT] Removed ${result.affectedRows} record(s)`
    );
  } catch (err) {
    logger.error(
      "[ADMIN-UPDATE-OTP-CLEANUP][BOOT][ERROR]",
      err.message
    );
  }
})();

// ------------------------------------------------------------
// 🔹 Recurring cleanup (every 5 minutes)
// ------------------------------------------------------------
cron.schedule(
  "*/5 * * * *",
  async () => {
    try {
      const [result] = await pool.query(`
        DELETE FROM admin_update_otp
        WHERE 
          expires_at < NOW()
          OR (locked_until IS NOT NULL AND locked_until < NOW())
          OR verified_at IS NOT NULL
      `);

      if (result.affectedRows > 0) {
        logger.info(
          `[ADMIN-UPDATE-OTP-CLEANUP][CRON] Removed ${result.affectedRows} record(s)`
        );
      }
    } catch (err) {
      logger.error(
        "[ADMIN-UPDATE-OTP-CLEANUP][CRON][ERROR]",
        err.message
      );
    }
  },
  {
    scheduled: true,
    timezone: "UTC",
  }
);
