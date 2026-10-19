const logger = require("../utils/logger");
const ExcelJS = require("exceljs");
const { jsPDF } = require("jspdf");
require("jspdf-autotable");
const userModel = require("../models/userModel");
const bcrypt = require("bcrypt");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const axios = require("axios");

// ✅ Get Profile
exports.getProfile = async (req, res) => {
  try {
    const user = await userModel.getUserById(req.user.id);
    res.json({ success: true, user });
  } catch (err) {
    logger.error("GetProfile error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.adminExportAllUsers = async (req, res) => {
  try {
    let page = 1;
    const limit = 500; // batch size (you can tune this)
    let allUsers = [];

    // ✅ Loop through all pages
    while (true) {
      const { users, total } = await userModel.getAllUsersForExport({
        ...req.query,
        page,
        limit,
      });
      if (!users.length) break;

      allUsers.push(...users);

      if (users.length < limit) break; // stop if last page
      page++;
    }

    if (!allUsers.length) {
      return res.status(404).json({
        success: false,
        message: "No users found for the given filters",
      });
    }

    // ✅ 1️⃣ Create Excel
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("All Users");

    sheet.columns = [
      { header: "User ID", key: "user_id", width: 10 },
      { header: "Name", key: "name", width: 25 },
      { header: "Email", key: "email", width: 30 },
      { header: "Phone", key: "phone_number", width: 15 },
      { header: "Active", key: "is_active", width: 10 },
      { header: "Verified", key: "is_verified", width: 10 },
      { header: "Created At", key: "created_at", width: 20 },
      { header: "Last Login", key: "last_login", width: 20 },
      { header: "Addresses", key: "addresses", width: 80 },
    ];

    allUsers.forEach((user) => {
      const addressString = user.addresses
        .map(
          (a) =>
            `${a.address_line1 || ""}, ${a.address_line2 || ""}, ${a.city || ""}, ${a.state || ""}, ${
              a.country || ""
            }, ${a.pincode || ""}, GST: ${a.gst_number || "N/A"}`
        )
        .join(" | ");
      sheet.addRow({
        ...user,
        addresses: addressString,
      });
    });

    const exportDir = path.join(__dirname, "../exports");
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir);

    const excelPath = path.join(exportDir, `users_export_all.xlsx`);
    await workbook.xlsx.writeFile(excelPath);

    // ✅ 2️⃣ Create PDF
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let pageDoc = pdfDoc.addPage();
    const { width, height } = pageDoc.getSize();
    let y = height - 50;

    pageDoc.drawText(`All Users Export Report`, {
      x: 50,
      y,
      size: 18,
      font,
      color: rgb(0, 0.53, 0.71),
    });

    y -= 30;

    for (const [i, user] of allUsers.entries()) {
      if (y < 80) {
        pageDoc = pdfDoc.addPage();
        y = height - 50;
      }

      pageDoc.drawText(`${i + 1}. ${user.name} (${user.email})`, { x: 50, y, size: 12, font });
      y -= 15;
      pageDoc.drawText(
        `Phone: ${user.phone_number} | Active: ${user.is_active ? "Yes" : "No"} | Verified: ${
          user.is_verified ? "Yes" : "No"
        }`,
        { x: 50, y, size: 10, font }
      );
      y -= 15;
      pageDoc.drawText(`Created: ${new Date(user.created_at).toLocaleString()}`, {
        x: 50,
        y,
        size: 10,
        font,
      });
      y -= 15;
      pageDoc.drawText(`Addresses:`, { x: 50, y, size: 10, font });
      y -= 12;

      user.addresses.forEach((a) => {
        pageDoc.drawText(
          `  - ${a.address_line1 || ""}, ${a.city || ""}, ${a.state || ""}, ${
            a.country || ""
          }, ${a.pincode || ""} (GST: ${a.gst_number || "N/A"})`,
          { x: 60, y, size: 9, font }
        );
        y -= 12;
      });
      y -= 10;
    }

    const pdfPath = path.join(exportDir, `users_export_all.pdf`);
    fs.writeFileSync(pdfPath, await pdfDoc.save());

    // ✅ 3️⃣ ZIP them together
    const zipPath = path.join(exportDir, `users_export_all.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(output);
    archive.file(excelPath, { name: "users_export_all.xlsx" });
    archive.file(pdfPath, { name: "users_export_all.pdf" });
    await archive.finalize();

    output.on("close", () => {
      res.download(zipPath, "users_export_all.zip", () => {
        fs.unlinkSync(excelPath);
        fs.unlinkSync(pdfPath);
        fs.unlinkSync(zipPath);
      });
    });
  } catch (err) {
    logger.error("❌ Export All Users Error:", err);
    res.status(500).json({
      success: false,
      message: "Error exporting all users data",
      error: err.message,
    });
  }
};

exports.getAllUsersWithAddresses = async (req, res) => {
  try {
    const result = await userModel.getAllUsersWithAddresses(req.query);
    return res.json({
      success: true,
      message: "Users with addresses fetched successfully",
      ...result,
    });
  } catch (err) {
    logger.error("❌ Get All Users With Addresses Error:", err);
    return res.status(500).json({
      success: false,
      message: "Error fetching users with addresses",
      error: err.message,
    });
  }
};


exports.getAllUsersWithAllAddresses = async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    let offset = (page - 1) * limit;

    let search = req.query.search || "";

    const { users, totalUsers } = await userModel.getAllUsersWithAllAddresses(
      page,
      limit,
      offset,
      search
    );

    res.json({
      success: true,
      totalUsers,
      page,
      totalPages: Math.ceil(totalUsers / limit),
      search,
      users
    });

  } catch (err) {
    logger.error("getAllUsersWithAllAddresses:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};



// ✅ Update Profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone_number } = req.body;
    await userModel.updateUser(req.user.id, { name, phone_number }); // fixed
    res.json({ success: true, message: "Profile updated" });
  } catch (err) {
    logger.error("UpdateProfile error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ✅ Change Password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user?.id;

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ success: false, message: "Current and new password are required" });
    }

    // ✅ Fetch user
    const user = await userModel.getUserByIdWithPassword(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (!user.password_hash) {
      return res
        .status(500)
        .json({ success: false, message: "Password not set for this user" });
    }

    // ✅ Compare old password
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid current password" });
    }

    // ✅ Ensure new password is different from current password
    if (currentPassword === newPassword) {
      return res
        .status(400)
        .json({ success: false, message: "New password cannot be the same as your current password" });
    }

    // ✅ Hash new password
    const hashed = await bcrypt.hash(newPassword, 10);

    // ✅ Update using email or ID
    await userModel.updatePasswordById(user.id, hashed);

    res.json({ success: true, message: "Password changed successfully" });
  } catch (err) {
    logger.error("ChangePassword error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.getAllUsersWithDefaultAddress = async (req, res) => {
  try {
    const users = await userModel.getAllUsersWithDefaultAddress();
    res.json({ success: true, users });
  } catch (err) {
    logger.error("GetAllUsersWithDefaultAddress error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const validateGSTNumber = (gstNumber) => {
  const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return gstRegex.test(gstNumber);
};

// ✅ Controller
exports.updateGSTNumber = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { gst_number } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!gst_number) {
      return res.status(400).json({ success: false, message: "GST number is required" });
    }

    // 🧾 Validate GST format
    if (!validateGSTNumber(gst_number)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid GST number format" });
    }

    // ✅ Update GST number in DB
    const updated = await userModel.updateGSTNumber(userId, gst_number);

    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "User not found or GST not updated" });
    }

    res.json({ success: true, message: "GST number updated successfully" });
  } catch (err) {
    logger.error("❌ updateGSTNumber error:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};

exports.getGSTNumber = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const gstData = await userModel.getGSTNumber(userId);

    if (!gstData) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({
      success: true,
      message: "GST number fetched successfully",
      gst_number: gstData.gst_number || null,
    });
  } catch (err) {
    logger.error("❌ getGSTNumber error:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};

// ✅ Helper function
const normalize = (value) =>
  value
    ?.toString()
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();


// ✅ Add Address

exports.addAddress = async (req, res) => {
  try {
    let {
      address_line1,
      address_line2,
      city,
      state,
      country,
      pincode,
      is_default,
    } = req.body;

    // -------------------------------
    // 1️⃣ Basic Required Validation
    // -------------------------------
    if (!address_line1 || !city || !state || !pincode) {
      return res.status(400).json({
        success: false,
        message: "Address Line 1, City, State and Pincode are required.",
      });
    }

    // -------------------------------
    // 2️⃣ Clean & Normalize Inputs
    // -------------------------------
    const cleanCity = city.trim();
    const cleanState = state.trim();
    const cleanPincode = pincode.trim();
    const cleanCountry = country?.trim() || "India";

    const normalizedCity = normalize(cleanCity);
    const normalizedState = normalize(cleanState);

    // -------------------------------
    // 3️⃣ Validate Pincode Format
    // -------------------------------
    const pinRegex = /^[1-9][0-9]{5}$/;
    if (!pinRegex.test(cleanPincode)) {
      return res.status(400).json({
        success: false,
        message: "Invalid pincode format. Must be a valid 6-digit pincode.",
      });
    }

    // -------------------------------
    // 4️⃣ Validate Pincode Existence
    // -------------------------------
    const response = await axios.get(
      `https://api.postalpincode.in/pincode/${cleanPincode}`
    );

    const pinData = response.data[0];

    if (pinData.Status !== "Success" || !pinData.PostOffice) {
      return res.status(400).json({
        success: false,
        message: "Pincode does not exist. Please enter a valid pincode.",
      });
    }

    const postOffices = pinData.PostOffice;

    // -------------------------------
    // 5️⃣ Validate State
    // -------------------------------
    const isValidState = postOffices.some(
      (office) => normalize(office.State) === normalizedState
    );

    if (!isValidState) {
      return res.status(400).json({
        success: false,
        message: `State does not match this pincode. Expected State: ${postOffices[0].State}`,
      });
    }

    // -------------------------------
    // 6️⃣ Validate City (Flexible Match)
    // -------------------------------
    const isValidCity = postOffices.some((office) => {
      const apiDistrict = normalize(office.District);
      const apiName = normalize(office.Name);

      return (
        apiDistrict === normalizedCity ||
        apiName === normalizedCity ||
        apiDistrict.includes(normalizedCity) ||
        normalizedCity.includes(apiDistrict)
      );
    });

    if (!isValidCity) {
      return res.status(400).json({
        success: false,
        message: `City does not match this pincode. Expected City: ${postOffices[0].District}`,
      });
    }

    // -------------------------------
    // 7️⃣ Save Address (Save Clean Values)
    // -------------------------------
    await userModel.addAddress({
      user_id: req.user.id,
      address_line1: address_line1.trim(),
      address_line2: address_line2?.trim() || null,
      city: cleanCity,
      state: cleanState,
      country: cleanCountry,
      pincode: cleanPincode,
      is_default: is_default || false,
    });

    return res.json({
      success: true,
      message: "Address added successfully",
    });

  } catch (err) {
    logger.error("❌ AddAddress error:", err.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


// ✅ Get All Addresses
exports.getAddresses = async (req, res) => {
  try {
    const addresses = await userModel.getAddressesByUserId(req.user.id);
    res.json({ success: true, addresses });
  } catch (err) {
    logger.error("GetAddresses error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ✅ Get Address by ID
exports.getAddressById = async (req, res) => {
  try {
    const address = await userModel.getAddressById(req.params.id, req.user.id);
    if (!address) {
      return res
        .status(404)
        .json({ success: false, message: "Address not found" });
    }
    res.json({ success: true, address });
  } catch (err) {
    logger.error("GetAddressById error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ✅ Update Address


exports.updateAddress = async (req, res) => {
  try {
    const addressId = req.params.id;
    const userId = req.user.id;

    let { city, state, pincode, ...otherFields } = req.body;

    let postOffices = null;

    // -------------------------------------------------
    // 1️⃣ Normalize inputs (if provided)
    // -------------------------------------------------
    const cleanCity = city ? city.trim() : null;
    const cleanState = state ? state.trim() : null;
    const cleanPincode = pincode ? pincode.trim() : null;

    const normalizedCity = cleanCity ? normalize(cleanCity) : null;
    const normalizedState = cleanState ? normalize(cleanState) : null;

    // -------------------------------------------------
    // 2️⃣ Validate pincode format (if provided)
    // -------------------------------------------------
    if (cleanPincode) {
      const pinRegex = /^[1-9][0-9]{5}$/;
      if (!pinRegex.test(cleanPincode)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid pincode format. Must be a valid 6-digit pincode.",
        });
      }

      // -------------------------------------------------
      // 3️⃣ Validate pincode existence
      // -------------------------------------------------
      const response = await axios.get(
        `https://api.postalpincode.in/pincode/${cleanPincode}`
      );

      const pinData = response.data[0];

      if (pinData.Status !== "Success" || !pinData.PostOffice) {
        return res.status(400).json({
          success: false,
          message: "Pincode does not exist. Please enter a valid pincode.",
        });
      }

      postOffices = pinData.PostOffice;
    }

    // -------------------------------------------------
    // 4️⃣ Validate State (if state + pincode provided)
    // -------------------------------------------------
    if (normalizedState && postOffices) {
      const isValidState = postOffices.some(
        (office) => normalize(office.State) === normalizedState
      );

      if (!isValidState) {
        return res.status(400).json({
          success: false,
          message: `State does not match this pincode. Expected State: ${postOffices[0].State}`,
        });
      }
    }

    // -------------------------------------------------
    // 5️⃣ Validate City (if city + pincode provided)
    // -------------------------------------------------
    if (normalizedCity && postOffices) {
      const isValidCity = postOffices.some((office) => {
        const apiDistrict = normalize(office.District);
        const apiName = normalize(office.Name);

        return (
          apiDistrict === normalizedCity ||
          apiName === normalizedCity ||
          apiDistrict.includes(normalizedCity) ||
          normalizedCity.includes(apiDistrict)
        );
      });

      if (!isValidCity) {
        return res.status(400).json({
          success: false,
          message: `City does not match this pincode. Expected City: ${postOffices[0].District}`,
        });
      }
    }

    // -------------------------------------------------
    // 6️⃣ Prepare Clean Update Payload
    // -------------------------------------------------
    const updatePayload = {
      ...otherFields,
      ...(cleanCity && { city: cleanCity }),
      ...(cleanState && { state: cleanState }),
      ...(cleanPincode && { pincode: cleanPincode }),
    };

    // -------------------------------------------------
    // 7️⃣ Update Address in DB
    // -------------------------------------------------
    const updated = await userModel.updateAddress(
      addressId,
      userId,
      updatePayload
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Address not found or not updated",
      });
    }

    return res.json({
      success: true,
      message: "Address updated successfully",
    });

  } catch (err) {
    logger.error("❌ UpdateAddress error:", err.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


// ✅ Delete Address
exports.deleteAddress = async (req, res) => {
  try {
    const deleted = await userModel.deleteAddress(req.params.id, req.user.id);
    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "Address not found" });
    }
    res.json({ success: true, message: "Address deleted successfully" });
  } catch (err) {
    logger.error("DeleteAddress error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ✅ Set Default Address
exports.setDefaultAddress = async (req, res) => {
  try {
    const updated = await userModel.setDefaultAddress(
      req.params.id,
      req.user.id
    );
    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "Address not found" });
    }
    res.json({ success: true, message: "Default address set successfully" });
  } catch (err) {
    logger.error("SetDefaultAddress error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
