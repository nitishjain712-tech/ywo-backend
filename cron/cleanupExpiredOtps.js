const logger = require("../utils/logger");
/**
 * ============================================================
 * 🧹 Admin OTP Cleanup Cron (Production Ready)
 * ============================================================
 *
 * ✔ Deletes expired OTPs
 * ✔ Deletes expired locks
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
    const [r1] = await pool.query(`
      DELETE FROM admin_otp
      WHERE expires_at < NOW()
         OR (locked_until IS NOT NULL AND locked_until < NOW())
    `);

    // Also clean up expired signup verification OTPs
    const [r2] = await pool.query(`
      DELETE FROM email_verification_otps WHERE expires_at < NOW()
    `);

    logger.info(
      `[OTP-CLEANUP][BOOT] Removed ${r1.affectedRows} admin OTP(s) and ${r2.affectedRows} signup OTP(s)`
    );
  } catch (err) {
    logger.error(
      "[OTP-CLEANUP][BOOT][ERROR]",
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
      const [r1] = await pool.query(`
        DELETE FROM admin_otp
        WHERE expires_at < NOW()
           OR (locked_until IS NOT NULL AND locked_until < NOW())
      `);

      // Also clean up expired signup verification OTPs
      const [r2] = await pool.query(`
        DELETE FROM email_verification_otps WHERE expires_at < NOW()
      `);

      if (r1.affectedRows > 0 || r2.affectedRows > 0) {
        logger.info(
          `[OTP-CLEANUP][CRON] Removed ${r1.affectedRows} admin OTP(s) and ${r2.affectedRows} signup OTP(s)`
        );
      }
    } catch (err) {
      logger.error(
        "[OTP-CLEANUP][CRON][ERROR]",
        err.message
      );
    }
  },
  {
    scheduled: true,
    timezone: "UTC"
  }
);
