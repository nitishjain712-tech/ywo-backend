const logger = require("../utils/logger");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const adminModel = require("../models/adminModel");
const emailService = require("../services/emailService");
require("dotenv").config();

// ============================================================
// ✅ JWT Token Helpers
// ============================================================

const generateAccessToken = (admin) => {
  return jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
};

const generateRefreshToken = (admin) => {
  return jwt.sign(
    { id: admin.id },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" }
  );
};

// ============================================================
// ✅ Super Admin - Create Super Admin
// ============================================================

exports.createSuperAdmin = async (req, res) => {
  try {
    const { name, email, phone_number, password } = req.body;

    if (!name || !email || !phone_number || !password) {
      return res.status(400).json({ success: false, message: "All fields required" });
    }

    const existing = await adminModel.findByEmail(email);
    if (existing) {
      return res.status(409).json({ success: false, message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const id = await adminModel.createAdmin({
      name,
      email: email.toLowerCase(),
      phone_number,
      role: "super_admin",
      password_hash: hashedPassword
    });

    res.status(201).json({
      success: true,
      message: "Super Admin created successfully",
      admin: { id, name, email: email.toLowerCase(), role: "super_admin" }
    });
  } catch (err) {
    logger.error("SuperAdmin creation error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ============================================================
// ✅ Register Admin (by Super Admin)
// ============================================================

exports.registerAdmin = async (req, res) => {
  try {
    const { name, email, phone_number, password, role = "admin" } = req.body;

    if (!name || !email || !phone_number || !password) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    const existing = await adminModel.findByEmail(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ success: false, message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const adminId = await adminModel.createAdmin({
      name,
      email: email.toLowerCase(),
      phone_number,
      role,
      password_hash: hashedPassword
    });

    res.status(201).json({
      success: true,
      message: "Admin registered successfully",
      admin: { id: adminId, name, email: email.toLowerCase(), phone_number, role }
    });
  } catch (err) {
    logger.error("Register admin error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ============================================================
// ✅ Login (Admin or Super Admin)
// ============================================================

// exports.login = async (req, res) => {
//   try {
//     const { email, password } = req.body;
//     logger.info(email, password)

//     if (!email || !password) {
//       return res.status(400).json({ success: false, message: "Email and password required" });
//     }

//     const admin = await adminModel.findByEmail(email.toLowerCase());
//     logger.info(admin)
//     if (!admin || admin.status !== "active") {
//       return res.status(401).json({ success: false, message: "Invalid credentials or inactive account" });
//     }

//     logger.info("RAW PASSWORD:", `[${password}]`);

//     const validPassword = await bcrypt.compare(
//       password.trim(),
//       admin.password
//     );

//     logger.info(validPassword)
//     if (!validPassword) {
//       return res.status(401).json({ success: false, message: "Invalid credentials" });
//     }

//     const accessToken = generateAccessToken(admin);
//     const refreshToken = generateRefreshToken(admin);
//     const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

//     await adminModel.storeRefreshToken(admin.id, refreshToken, expiresAt);
//     await adminModel.updateLastLogin(admin.id);

//     res.json({
//       success: true,
//       message: "Login successful",
//       accessToken,
//       refreshToken,
//       expiresAt,
//       admin: {
//         id: admin.id,
//         name: admin.name,
//         email: admin.email,
//         role: admin.role,
//         status: admin.status
//       }
//     });
//   } catch (err) {
//     logger.error("Login error:", err);
//     res.status(500).json({ success: false, message: "Internal server error" });
//   }
// };


exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password required"
      });
    }

    // 1️⃣ Find admin
    const admin = await adminModel.findByEmail(email.toLowerCase());
    if (!admin || admin.status !== "active") {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials or inactive account"
      });
    }

    // 2️⃣ Verify password
    const validPassword = await bcrypt.compare(password.trim(), admin.password);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials"
      });
    }

    // 3️⃣ Generate OTP
    const rawOtp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log("OTP",rawOtp)
const hashedOtp = await bcrypt.hash(rawOtp, 10);    
const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // 4️⃣ Store OTP
    await adminModel.storeOTP(admin.id, hashedOtp, expiresAt);

    // 5️⃣ Send OTP email
    await emailService.sendOTPEmail(admin.email, rawOtp, admin.name);

    // 🚨 NO TOKENS HERE
    return res.json({
      success: true,
      message: "OTP sent to your email",
      adminId: admin.id,
      expiresIn: "10 minutes"
    });

  } catch (err) {
    logger.error("Login step-1 error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};


// ============================================================
// ✅ Logout
// ============================================================

exports.logout = async (req, res) => {
  try {
    // Remove refresh token from DB
    await adminModel.deleteRefreshToken(req.admin.id);
    res.json({ success: true, message: "Logout successfully" });
  } catch (err) {
    logger.error("Logout error:", err);
    res.status(500).json({ success: false, message: "Logout failed" });
  }
};

// ============================================================
// ✅ Refresh Token
// ============================================================

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, message: "Refresh token missing" });

    jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, async (err, decoded) => {
      if (err) return res.status(403).json({ success: false, message: "Invalid refresh token" });

      // Check token in DB (handles logout and expiry)
      const storedToken = await adminModel.findRefreshToken(decoded.id);
      if (!storedToken || storedToken !== refreshToken) {
        return res.status(403).json({ success: false, message: "Refresh token expired or invalid" });
      }

      // Fetch admin
      const admin = await adminModel.getAdminById(decoded.id);
      if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });

      // Generate new access token
      const newAccessToken = jwt.sign({ id: admin.id, email: admin.email, role: admin.role }, process.env.JWT_SECRET, { expiresIn: "15m" });
      res.json({ success: true, accessToken: newAccessToken });
    });
  } catch (err) {
    logger.error("Refresh token error:", err);
    res.status(500).json({ success: false, message: "Could not refresh token" });
  }
};

// ============================================================
// ✅ Update Admin (Super Admin)
// ============================================================


// ✅ Update Admin Controller
exports.updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    let { name, email, phone_number, role, status, password } = req.body;

    // 1️⃣ Check admin exists
    const adminToUpdate = await adminModel.getAdminById(id);
    if (!adminToUpdate) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }

    // 2️⃣ Build dynamic update data
    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (email) updateData.email = email.toLowerCase();
    if (phone_number !== undefined) updateData.phone_number = phone_number;
    if (role !== undefined) updateData.role = role;
    if (status !== undefined) updateData.status = status;

    // 3️⃣ Handle password update
    if (password && password.trim() !== "") {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateData.password = hashedPassword; // ✅ use correct column name
    }

    // 4️⃣ Guard: nothing to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No update fields provided"
      });
    }

    // 5️⃣ Update in DB
    await adminModel.updateAdmin(id, updateData);

    res.json({ success: true, message: "Admin updated successfully" });
  } catch (err) {
    logger.error("Update admin error:", err.message);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message
    });
  }
};

// ============================================================
// ✅ Request Admin Update otp wala code for admin update
// ============================================================

exports.requestAdminUpdate = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone_number, role, status, password } = req.body;

    // 1️⃣ Check target admin exists
    const admin = await adminModel.getAdminById(id);
    if (!admin) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }

    // 2️⃣ Build update payload
    const payload = {};

    if (name !== undefined) payload.name = name;
    if (email) payload.email = email.toLowerCase();
    if (phone_number !== undefined) payload.phone_number = phone_number;
    if (role !== undefined) payload.role = role;
    if (status !== undefined) payload.status = status;

    if (password && password.trim()) {
      payload.password = await bcrypt.hash(password, 10);
    }

    if (!Object.keys(payload).length) {
      return res.status(400).json({
        success: false,
        message: "No update fields provided"
      });
    }

    // 3️⃣ Generate OTP
    const rawOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = await bcrypt.hash(rawOtp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    // 4️⃣ Store pending update
    await adminModel.createAdminUpdateOtp({
      target_admin_id: id,
      otp: hashedOtp,
      payload: JSON.stringify(payload),
      expires_at: expiresAt
    });

    // 5️⃣ Send OTP to Super Admin
    await emailService.sendOTPEmail(
      process.env.SUPER_ADMIN_EMAIL,
      rawOtp,
      "Super Admin"
    );

    return res.json({
      success: true,
      message: "OTP sent to Super Admin for approval",
      expiresIn: "10 minutes"
    });

  } catch (err) {
    logger.error("Request admin update error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};


exports.verifyAdminUpdateOtp = async (req, res) => {
  try {
    const { targetAdminId, otp } = req.body;

    if (!targetAdminId || !otp) {
      return res.status(400).json({
        success: false,
        message: "Admin ID and OTP are required"
      });
    }

    const record = await adminModel.getAdminUpdateOtp(targetAdminId);

    if (!record) {
      return res.status(404).json({
        success: false,
        message: "OTP expired or not found"
      });
    }

    // 🔒 If already locked
    if (record.locked_until && new Date(record.locked_until) > new Date()) {
      return res.status(429).json({
        success: false,
        message: "Too many attempts. Try again after 10 minutes."
      });
    }

    // ⏰ Expiry check
    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired. Please resend OTP."
      });
    }

    const isValid = await bcrypt.compare(otp.toString(), record.otp);

    // ❌ INVALID OTP
    if (!isValid) {
      const nextAttempts = record.attempts + 1;
      const MAX_ATTEMPTS = 3;

      // 🚫 Lock OTP
      if (nextAttempts >= MAX_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + 10 * 60 * 1000);

        await adminModel.lockAdminUpdateOtp(
          record.id,
          nextAttempts,
          lockUntil
        );

        return res.status(429).json({
          success: false,
          message:
            "OTP locked after 3 failed attempts. Try again after 10 minutes."
        });
      }

      // ➕ Increment attempts
      await adminModel.incrementAdminUpdateOtpAttempts(
        record.id,
        nextAttempts
      );

      return res.status(401).json({
        success: false,
        message: `Invalid OTP. Attempts left: ${MAX_ATTEMPTS - nextAttempts}`
      });
    }

    // ✅ OTP IS VALID
const updateData =
  typeof record.payload === "string"
    ? JSON.parse(record.payload)
    : record.payload;
    await adminModel.updateAdmin(record.target_admin_id, updateData);
    await adminModel.markAdminUpdateOtpVerified(record.id);

    return res.json({
      success: true,
      message: "Admin updated successfully"
    });

  } catch (err) {
    logger.error("Verify update OTP error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

exports.resendAdminUpdateOtp = async (req, res) => {
  try {
    const { targetAdminId } = req.body;

    if (!targetAdminId) {
      return res.status(400).json({
        success: false,
        message: "Target admin ID required"
      });
    }

    const record = await adminModel.getAdminUpdateOtp(targetAdminId);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: "No pending update found"
      });
    }

    const rawOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = await bcrypt.hash(rawOtp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await adminModel.resetAdminUpdateOtp(
      record.id,
      hashedOtp,
      expiresAt
    );

    await emailService.sendOTPEmail(
      process.env.SUPER_ADMIN_EMAIL,
      rawOtp,
      "Super Admin"
    );

    return res.json({
      success: true,
      message: "OTP resent successfully",
      expiresIn: "10 minutes"
    });

  } catch (err) {
    logger.error("Resend update OTP error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

// ============================================================
// ✅ Activate / Deactivate Admin
// ============================================================

exports.changeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["active", "inactive"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const admin = await adminModel.getAdminById(id);
    if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });

    await adminModel.updateAdminStatus(id, status);

    res.json({
      success: true,
      message: `Admin ${status === "active" ? "activated" : "deactivated"} successfully`
    });
  } catch (err) {
    logger.error("Change status error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid admin ID" });
    }

    const admin = await adminModel.getAdminById(id);
    if (!admin) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }

    await adminModel.deleteAdmin(id);

    res.json({ success: true, message: "Admin deleted successfully" });
  } catch (err) {
    logger.error("Delete admin error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};


exports.getAllAdmins = async (req, res) => {
  try {
    const admins = await adminModel.getAllAdmins();
    res.json({ success: true, admins });
  } catch (err) {
    logger.error("Get all admins error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.updateAdminStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["active", "inactive"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const admin = await adminModel.getAdminById(id);
    if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });

    await adminModel.updateAdminStatus(id, status);

    res.json({
      success: true,
      message: `Admin ${status === "active" ? "activated" : "deactivated"} successfully`
    });
  } catch (err) {
    logger.error("Change status error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ============================================================
// ✅ Get Admin Profile (Admin or Super Admin)
// ============================================================

exports.getProfile = async (req, res) => {
  try {
    const admin = await adminModel.getAdminById(req.admin.id);
    if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });

    res.json({
      success: true,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        phone_number: admin.phone_number,
        role: admin.role,
        status: admin.status
      }
    });
  } catch (err) {
    logger.error("Get profile error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ============================================================
// ✅ Step 1: Send OTP (Email + Password)
// ============================================================

exports.sendOTP = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password required"
      });
    }

    // 1️⃣ Find admin
    const admin = await adminModel.findByEmail(email.toLowerCase());
    if (!admin || admin.status !== "active") {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials or inactive account"
      });
    }

    // 2️⃣ Verify password
    const validPassword = await bcrypt.compare(password.trim(), admin.password);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials"
      });
    }

    // 3️⃣ Generate OTP
    const rawOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = await bcrypt.hash(rawOtp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    // 4️⃣ Store hashed OTP
    await adminModel.storeOTP(admin.id, hashedOtp, expiresAt);

    // 5️⃣ Send OTP email (plain OTP)
    await emailService.sendOTPEmail(admin.email, rawOtp, admin.name);

    return res.json({
      success: true,
      message: "OTP sent successfully",
      adminId: admin.id,
      expiresIn: "10 minutes"
    });

  } catch (err) {
    logger.error("Send OTP error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

// ============================================================
// ✅ Step 2: Verify OTP & Login
// ============================================================


// exports.verifyOTP = async (req, res) => {
//   try {
//     const { adminId, otp } = req.body;

//     if (!adminId || !otp) {
//       return res.status(400).json({
//         success: false,
//         message: "Admin ID and OTP required"
//       });
//     }

//     // 1️⃣ Fetch admin
//     const admin = await adminModel.getAdminById(adminId);
//     if (!admin || admin.status !== "active") {
//       return res.status(404).json({
//         success: false,
//         message: "Admin not found or inactive"
//       });
//     }

//     // 2️⃣ Fetch OTP
//     const otpData = await adminModel.getOTP(adminId);
//     if (!otpData) {
//       return res.status(400).json({
//         success: false,
//         message: "OTP expired or not found"
//       });
//     }

//     // 3️⃣ Compare OTP
//     const isValid = await bcrypt.compare(otp.toString(), otpData.otp);
//     if (!isValid) {
//       return res.status(401).json({
//         success: false,
//         message: "Invalid OTP"
//       });
//     }

//     // 4️⃣ Mark OTP verified & delete
//     await adminModel.verifyOTP(adminId);
//     await adminModel.deleteOTP(adminId);

//     // 5️⃣ Generate tokens (LOGIN HAPPENS HERE)
//     const accessToken = generateAccessToken(admin);
//     const refreshToken = generateRefreshToken(admin);
//     const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

//     await adminModel.storeRefreshToken(admin.id, refreshToken, expiresAt);
//     await adminModel.updateLastLogin(admin.id);

//     return res.json({
//       success: true,
//       message: "Login successful",
//       accessToken,
//       refreshToken,
//       expiresAt,
//       admin: {
//         id: admin.id,
//         name: admin.name,
//         email: admin.email,
//         role: admin.role,
//         status: admin.status
//       }
//     });

//   } catch (err) {
//     logger.error("Verify OTP error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Internal server error"
//     });
//   }
// };


exports.verifyOTP = async (req, res) => {
  try {
    const { adminId, otp } = req.body;

    if (!adminId || !otp) {
      return res.status(400).json({
        success: false,
        message: "Admin ID and OTP required"
      });
    }

    const admin = await adminModel.getAdminById(adminId);
    if (!admin || admin.status !== "active") {
      return res.status(404).json({
        success: false,
        message: "Admin not found or inactive"
      });
    }

    const otpData = await adminModel.getOTPWithLock(adminId);
    if (!otpData) {
      return res.status(400).json({
        success: false,
        message: "OTP expired or not found"
      });
    }

    // 🔒 Check lock
    if (otpData.locked_until && new Date(otpData.locked_until) > new Date()) {
      return res.status(429).json({
        success: false,
        message: "Too many attempts. Try again after 10 minutes."
      });
    }

    const isValid = await bcrypt.compare(otp.toString(), otpData.otp);

    if (!isValid) {
      const attempts = otpData.attempts + 1;

      if (attempts >= 3) {
        const lockUntil = new Date(Date.now() + 10 * 60 * 1000);
        await adminModel.lockOTP(adminId, attempts, lockUntil);

        return res.status(429).json({
          success: false,
          message: "OTP locked after 3 failed attempts. Try again in 10 minutes."
        });
      }

      await adminModel.incrementOTPAttempts(adminId, attempts);

      return res.status(401).json({
        success: false,
        message: `Invalid OTP. Attempts left: ${3 - attempts}`
      });
    }

    // ✅ OTP correct
    await adminModel.clearOTP(adminId);

    const accessToken = generateAccessToken(admin);
    const refreshToken = generateRefreshToken(admin);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await adminModel.storeRefreshToken(admin.id, refreshToken, expiresAt);
    await adminModel.updateLastLogin(admin.id);

    return res.json({
  success: true,
  message: "Login successful",
  accessToken,
  refreshToken,
  expiresAt,
  admin: {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    status: admin.status
  }
});


  } catch (err) {
    logger.error("Verify OTP error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};





// ============================================================
// ✅ Resend OTP
// ============================================================

exports.resendOTP = async (req, res) => {
  try {
    const { adminId } = req.body;

    if (!adminId) {
      return res.status(400).json({
        success: false,
        message: "Admin ID required"
      });
    }

    const admin = await adminModel.getAdminById(adminId);
    if (!admin || admin.status !== "active") {
      return res.status(404).json({
        success: false,
        message: "Admin not found or inactive"
      });
    }

    const rawOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = await bcrypt.hash(rawOtp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await adminModel.storeOTP(admin.id, hashedOtp, expiresAt);
    await emailService.sendOTPEmail(admin.email, rawOtp, admin.name);

    return res.json({
      success: true,
      message: "OTP resent successfully",
      expiresIn: "10 minutes"
    });

  } catch (err) {
    logger.error("Resend OTP error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};


exports.getDashboardStats = async (req, res) => {
  try {
    const stats = await adminModel.getDashboardStats();
    res.json({
      success: true,
      stats
    });
  } catch (err) {
    logger.error("Dashboard stats error:", err);
    res.status(500).json({ success: false, message: "Internal server error", error: err.message });
  }
};
