const logger = require("../utils/logger");
const fs = require("fs");
const path = require("path");
const Banner = require("../models/bannerModel");

// ✅ Helper to delete file safely
const deleteFile = (filePath) => {
  if (!filePath) return;
  const fullPath = path.join(__dirname, "..", filePath);
  fs.unlink(fullPath, (err) => {
    if (err && err.code !== "ENOENT") {
      logger.error("❌ Error deleting file:", err.message);
    }
  });
};

// ✅ Create Banner
exports.createBanner = async (req, res) => {
  try {
    const { banner_name, is_active } = req.body;

    if (!banner_name || banner_name.trim().length < 2) {
      return res.status(400).json({ message: "Banner name is required (min 2 chars)" });
    }

    const banner_image = req.file ? `/uploads/banners/${req.file.filename}` : null;

    const bannerId = await Banner.createBanner({
      banner_name,
      banner_image,
      is_active: is_active !== undefined ? !!is_active : true,
    });

    res.status(201).json({ message: "Banner created successfully", id: bannerId });
  } catch (err) {
    logger.error("Error creating banner:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// ✅ Get all banners
exports.getBanners = async (req, res) => {
  try {
    const banners = await Banner.getAllBanners();
    res.json(banners);
  } catch (err) {
    logger.error("Error fetching banners:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getActiveBanners = async (req, res) => {
  try {
    const activeBanners = await Banner.getAllActiveBanners();
    res.json(activeBanners);
  } catch (err) {
    logger.error("Error fetching active banners:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// ✅ Get single banner
exports.getBannerById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid banner ID" });

    const banner = await Banner.getBannerById(id);
    if (!banner) return res.status(404).json({ message: "Banner not found" });

    res.json(banner);
  } catch (err) {
    logger.error("Error fetching banner:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// ✅ Update Banner
exports.updateBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const { banner_name, is_active } = req.body;

    if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid banner ID" });

    const oldBanner = await Banner.getBannerForImage(id);
    if (!oldBanner) return res.status(404).json({ message: "Banner not found" });

    let banner_image = oldBanner.banner_image;
    if (req.file) {
      if (oldBanner.banner_image) deleteFile(oldBanner.banner_image);
      banner_image = `/uploads/banners/${req.file.filename}`;
    }

    const success = await Banner.updateBanner(id, {
      banner_name,
      banner_image,
      is_active,
    });

    if (!success) return res.status(400).json({ message: "Banner not updated" });

    res.json({ message: "Banner updated successfully" });
  } catch (err) {
    logger.error("Error updating banner:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// ✅ Delete Banner
exports.deleteBanner = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid banner ID" });

    const banner = await Banner.getBannerForImage(id);
    if (!banner) return res.status(404).json({ message: "Banner not found" });

    const success = await Banner.deleteBanner(id);
    if (!success) return res.status(400).json({ message: "Banner not deleted" });

    if (banner.banner_image) deleteFile(banner.banner_image);

    res.json({ message: "Banner deleted successfully" });
  } catch (err) {
    logger.error("Error deleting banner:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};
