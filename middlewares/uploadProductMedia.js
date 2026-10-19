const logger = require("../utils/logger");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ================== Storage Config ==================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {

      let folderName;
      
      // UPDATE PRODUCT -----> route always has :id
      if (req.params.id) {
        folderName = `product-${req.params.id}`;
      }
      // CREATE PRODUCT ----> no params id yet so mark TEMP folder
      else if (req.uploadTempFolder) {
        folderName = req.uploadTempFolder;
      }
      else {
        const tempStamp = Date.now();
        folderName = `temp-${tempStamp}`;
        req.uploadTempFolder = folderName;
      }

      req.uploadFolderName = folderName;

      const uploadPath = path.join(__dirname, "../uploads/products", folderName);

      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }

      cb(null, uploadPath);
    } catch (err) {
      cb(new Error("Failed to set upload destination: " + err.message));
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});


// ================== File Filter ==================
const fileFilter = (req, file, cb) => {
  try {
    const allowedImageTypes = /jpeg|jpg|png|webp/;
    const allowedVideoTypes = /mp4|mkv/;

    const ext = path.extname(file.originalname).toLowerCase().substring(1);
    const mime = file.mimetype.toLowerCase();

    if (
      (allowedImageTypes.test(ext) && mime.startsWith("image/")) ||
      (allowedVideoTypes.test(ext) && mime.startsWith("video/"))
    ) {
      return cb(null, true);
    }
    return cb(new Error("Invalid file type."), false);
  } catch (err) {
    return cb(new Error("File filter error: " + err.message), false);
  }
};

// ================== Multer Upload ==================
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024, files: 11 },
  fileFilter
});

// ================== Cleanup Uploaded Files ==================
exports.cleanupUploadedFiles = (files) => {
  if (!files) return;
  try {
    const allFiles = [
      ...(files["images"] || []),
      ...(files["video"] || [])
    ];

    allFiles.forEach((file) => {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    });
  } catch (err) {
    logger.error("Error cleaning up uploaded files:", err.message);
  }
};

// ================== Export Middleware ==================
exports.uploadProductMedia = (req, res, next) => {
  const uploader = upload.fields([
    { name: "images", maxCount: 10 },
    { name: "video", maxCount: 1 }
  ]);

  uploader(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message });
    next();
  });
};
