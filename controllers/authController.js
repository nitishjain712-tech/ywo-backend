const logger = require("../utils/logger");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../config/db");
const userModel = require("../models/userModel");
const { sendOTPEmail, sendSignupVerificationEmail } = require("../utils/email");
require("dotenv").config();

/* -------------------------------------------------
   TOKEN HELPERS
--------------------------------------------------*/

// Short-lived (access) token → 1 day expiry
const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
};

// Long-lived (refresh) token → 7 days expiry
const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user.id },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" }
  );
};

/* -------------------------------------------------
   SIGNUP – STEP 1: SEND EMAIL OTP
   POST /api/auth/signup/send-otp
--------------------------------------------------*/
exports.sendSignupOtp = async (req, res) => {
  try {
    let { name, email, phone_number, password } = req.body;

    // ── Validate fields ──────────────────────────────────────────────
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ success: false, message: "Name must be at least 2 characters" });
    }

    const emailRegex = /^[a-zA-Z0-9._%+-]+@(gmail\.com|yahoo\.com|yahoo\.in|outlook\.com|hotmail\.com|icloud\.com)$/i;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: "Please use a valid provider (e.g. @gmail.com, @yahoo.com)" });
    }

    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phone_number)) {
      return res.status(400).json({ success: false, message: "Invalid phone number (must be 10 digits starting with 6-9)" });
    }

    const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/;
    if (!strongPasswordRegex.test(password)) {
      return res.status(400).json({ 
        success: false, 
        message: "Password must be at least 6 characters and contain uppercase, lowercase, number, and special character" 
      });
    }

    email = email.toLowerCase().trim();

    // ── Check duplicates ─────────────────────────────────────────────
    const [existingUsers] = await pool.query(
      `SELECT email, phone_number FROM users WHERE email = ? OR phone_number = ?`,
      [email, phone_number]
    );

    if (existingUsers.length > 0) {
      for (const record of existingUsers) {
        if (record.email === email) {
          return res.status(400).json({ success: false, message: "Email already registered" });
        }
        if (record.phone_number === phone_number) {
          return res.status(400).json({ success: false, message: "Phone number already registered" });
        }
      }
    }

    // ── Rate-limit: check existing pending OTP record ────────────────
    const [existingOtpRows] = await pool.query(
      `SELECT id, otp_attempts, created_at FROM email_verification_otps 
       WHERE email = ? AND expires_at > NOW()`,
      [email]
    );

    if (existingOtpRows.length > 0) {
      const record = existingOtpRows[0];
      if (record.otp_attempts >= 3) {
        return res.status(429).json({
          success: false,
          message: "Too many OTP requests. Please wait 10 minutes before trying again.",
        });
      }
    }

    // ── Generate 6-digit OTP ─────────────────────────────────────────
    const rawOtp = crypto.randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(rawOtp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    // ── Hash the password for temporary storage ──────────────────────
    const hashedPassword = await bcrypt.hash(password, 10);

    // ── Upsert into email_verification_otps ─────────────────────────
    await pool.query(
      `INSERT INTO email_verification_otps 
         (email, name, phone_number, password_hash, otp_hash, expires_at, otp_attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE
         name           = VALUES(name),
         phone_number   = VALUES(phone_number),
         password_hash  = VALUES(password_hash),
         otp_hash       = VALUES(otp_hash),
         expires_at     = VALUES(expires_at),
         otp_attempts   = otp_attempts + 1,
         created_at     = NOW()`,
      [email, name, phone_number, hashedPassword, otpHash, expiresAt]
    );

    // ── Send OTP email ───────────────────────────────────────────────
    await sendSignupVerificationEmail(email, name, rawOtp);

    return res.status(200).json({
      success: true,
      message: "OTP sent to your email. Please verify to complete registration.",
      email, // send back so frontend can use it
    });
  } catch (err) {
    logger.error("Send signup OTP error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/* -------------------------------------------------
   SIGNUP – STEP 2: VERIFY OTP & CREATE USER
   POST /api/auth/signup/verify-otp
--------------------------------------------------*/
exports.verifySignupOtp = async (req, res) => {
  try {
    let { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and OTP are required" });
    }

    email = email.toLowerCase().trim();
    otp = otp.toString().trim();

    // ── Fetch pending record ─────────────────────────────────────────
    const [rows] = await pool.query(
      `SELECT * FROM email_verification_otps 
       WHERE email = ? AND expires_at > NOW()`,
      [email]
    );

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        message: "OTP expired or not found. Please request a new OTP.",
      });
    }

    const record = rows[0];

    // ── Count verify attempts ────────────────────────────────────────
    if (record.verify_attempts >= 3) {
      // Also delete the record to force re-request
      await pool.query(`DELETE FROM email_verification_otps WHERE email = ?`, [email]);
      return res.status(400).json({
        success: false,
        message: "Too many invalid attempts. Please request a new OTP.",
      });
    }

    // ── Compare hashed OTP ───────────────────────────────────────────
    const isValidOtp = await bcrypt.compare(otp, record.otp_hash);

    if (!isValidOtp) {
      // Increment verify_attempts
      await pool.query(
        `UPDATE email_verification_otps SET verify_attempts = verify_attempts + 1 WHERE email = ?`,
        [email]
      );
      const remaining = 3 - (record.verify_attempts + 1);
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${remaining > 0 ? `${remaining} attempt(s) remaining.` : "No attempts left. Please request a new OTP."}`,
        attemptsRemaining: remaining,
      });
    }

    // ── OTP is valid – check if user already exists (race-condition guard) ──
    const existingUser = await userModel.findByEmailOrPhone(email, record.phone_number);
    if (existingUser) {
      await pool.query(`DELETE FROM email_verification_otps WHERE email = ?`, [email]);
      return res.status(400).json({ success: false, message: "Account already exists." });
    }

    // ── Create the real user ─────────────────────────────────────────
    const userId = await userModel.createUser({
      name: record.name,
      email,
      phone_number: record.phone_number,
      password_hash: record.password_hash,
    });

    // ── Mark email as verified immediately ──────────────────────────
    await pool.query(
      `UPDATE users SET is_verified = TRUE WHERE id = ?`,
      [userId]
    );

    // ── Clean up OTP record ──────────────────────────────────────────
    await pool.query(`DELETE FROM email_verification_otps WHERE email = ?`, [email]);

    // ── Generate auth tokens ─────────────────────────────────────────
    const newUser = { id: userId, email };
    const accessToken = generateAccessToken(newUser);
    const refreshToken = generateRefreshToken(newUser);
    const accessTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await userModel.storeRefreshToken(userId, refreshToken, refreshExpiresAt);
    await userModel.updateLastLogin(userId);

    return res.status(201).json({
      success: true,
      message: "Email verified! Account created successfully.",
      accessToken,
      refreshToken,
      expiresAt: accessTokenExpiresAt,
      user: {
        id: userId,
        name: record.name,
        email,
        phone_number: record.phone_number,
      },
    });
  } catch (err) {
    logger.error("Verify signup OTP error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/* -------------------------------------------------
   SIGNUP – OTP RESEND (max 3 total sends)
   POST /api/auth/signup/resend-otp
--------------------------------------------------*/
exports.resendSignupOtp = async (req, res) => {
  try {
    let { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });
    email = email.toLowerCase().trim();

    // ── Check pending record ─────────────────────────────────────────
    const [rows] = await pool.query(
      `SELECT * FROM email_verification_otps WHERE email = ?`,
      [email]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "No pending signup found for this email. Please start over.",
      });
    }

    const record = rows[0];

    if (record.otp_attempts >= 3) {
      return res.status(429).json({
        success: false,
        message: "Maximum OTP resend limit (3) reached. Please wait 10 minutes and try again.",
      });
    }

    // ── Generate new OTP ─────────────────────────────────────────────
    const rawOtp = crypto.randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(rawOtp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `UPDATE email_verification_otps 
       SET otp_hash = ?, expires_at = ?, verify_attempts = 0, otp_attempts = otp_attempts + 1
       WHERE email = ?`,
      [otpHash, expiresAt, email]
    );

    await sendSignupVerificationEmail(email, record.name, rawOtp);

    return res.status(200).json({
      success: true,
      message: "New OTP sent to your email.",
      attemptsLeft: 3 - (record.otp_attempts + 1),
    });
  } catch (err) {
    logger.error("Resend signup OTP error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/* -------------------------------------------------
   LEGACY SIGNUP (kept for admin compatibility)
--------------------------------------------------*/
exports.signup = async (req, res) => {
  try {
    let { name, email, phone_number, password } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ success: false, message: "Name must be at least 2 characters" });
    }

    const emailRegex = /^[a-zA-Z0-9._%+-]+@(gmail\.com|yahoo\.com|yahoo\.in|outlook\.com|hotmail\.com|icloud\.com)$/i;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: "Please use a valid provider (e.g. @gmail.com, @yahoo.com)" });
    }

    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phone_number)) {
      return res.status(400).json({ success: false, message: "Invalid phone number (must be 10 digits starting with 6-9)" });
    }

    const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/;
    if (!strongPasswordRegex.test(password)) {
      return res.status(400).json({ 
        success: false, 
        message: "Password must be at least 6 characters and contain uppercase, lowercase, number, and special character" 
      });
    }

    email = email.toLowerCase().trim();

    const [existingUsers] = await pool.query(
      `SELECT email, phone_number FROM users WHERE email = ? OR phone_number = ?`,
      [email, phone_number]
    );

    if (existingUsers.length > 0) {
      for (const record of existingUsers) {
        if (record.email === email) {
          return res.status(400).json({ success: false, message: "Email already exists" });
        }
        if (record.phone_number === phone_number) {
          return res.status(400).json({ success: false, message: "Phone number already exists" });
        }
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = await userModel.createUser({
      name,
      email,
      phone_number,
      password_hash: hashedPassword,
    });

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: { id: userId, name, email, phone_number },
    });
  } catch (err) {
    logger.error("Signup error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/* -------------------------------------------------
   LOGIN
--------------------------------------------------*/
exports.login = async (req, res) => {
  try {
    const { email, phone_number, password } = req.body;
    if ((!email && !phone_number) || !password)
      return res.status(400).json({ success: false, message: "Email/Phone and password required" });

    const user = await userModel.findByEmailOrPhone(
      email?.toLowerCase(),
      phone_number
    );
    if (!user) return res.status(401).json({ success: false, message: "Please Enter Correct email/phone number or password" });

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword)
      return res.status(401).json({ success: false, message: "Please Enter Correct Password" });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    const accessTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = ?`, [user.id]);
    await userModel.storeRefreshToken(user.id, refreshToken, expiresAt);
    await userModel.updateLastLogin(user.id);

    res.json({
      success: true,
      message: "Login successful",
      accessToken,
      refreshToken,
      expiresAt: accessTokenExpiresAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone_number: user.phone_number,
      },
    });
  } catch (err) {
    logger.error("Login error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/* -------------------------------------------------
   LOGOUT
--------------------------------------------------*/
exports.logout = async (req, res) => {
  try {
    let refreshToken = null;

    const authHeader = req.headers["authorization"];
    if (authHeader?.startsWith("Bearer ")) {
      refreshToken = authHeader.slice(7).trim();
    }

    if (!refreshToken && req.body?.refreshToken) {
      refreshToken = req.body.refreshToken.trim();
    }

    if (refreshToken) {
      await pool.query(`DELETE FROM refresh_tokens WHERE token = ?`, [refreshToken]);
    }

    return res.status(200).json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    logger.error("❌ Logout error:", err);
    return res.status(200).json({ success: true, message: "Logged out (server cleanup skipped)" });
  }
};

/* -------------------------------------------------
   REFRESH TOKEN
--------------------------------------------------*/
exports.refreshToken = async (req, res) => {
  try {
    const incomingToken = req.body.refreshToken || req.cookies?.refreshToken;
    if (!incomingToken)
      return res.status(400).json({ success: false, message: "Missing refresh token" });

    let decoded;
    try {
      decoded = jwt.verify(incomingToken, process.env.REFRESH_TOKEN_SECRET);
    } catch (err) {
      return res.status(403).json({ success: false, message: "Invalid refresh token" });
    }

    const [rows] = await pool.query(
      `SELECT * FROM refresh_tokens WHERE user_id = ? AND token = ? AND expires_at > NOW()`,
      [decoded.id, incomingToken]
    );
    if (!rows.length)
      return res.status(403).json({ success: false, message: "Invalid or expired refresh token" });

    const user = await userModel.getUserById(decoded.id);
    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = ? AND token = ?`, [decoded.id, incomingToken]);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, created_at, expires_at) VALUES (?, ?, NOW(), ?)`,
      [user.id, newRefreshToken, expiresAt]
    );

    res.json({ success: true, accessToken: newAccessToken, refreshToken: newRefreshToken, expiresAt });
  } catch (err) {
    logger.error("Refresh token error:", err);
    res.status(500).json({ success: false, message: "Could not refresh token" });
  }
};

/* -------------------------------------------------
   PASSWORD RESET
--------------------------------------------------*/
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "Email required" });

    const user = await userModel.findByEmail(email);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await userModel.setPasswordResetOTP(email, otp, expiresAt);
    await sendOTPEmail(email, otp);

    res.json({ success: true, message: "OTP sent to email" });
  } catch (err) {
    logger.error("Forgot password error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await userModel.verifyPasswordResetOTP(email, otp);
    if (!user) return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    res.json({ success: true, message: "OTP verified, proceed to reset password" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword)
      return res.status(400).json({ success: false, message: "Email, OTP, and new password required" });

    const user = await userModel.verifyPasswordResetOTP(email, otp);
    if (!user)
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await userModel.updatePassword(email, hashedPassword);
    await userModel.clearPasswordResetOTP(email);

    res.json({ success: true, message: "Password reset successful" });
  } catch (err) {
    logger.error("Reset password error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
