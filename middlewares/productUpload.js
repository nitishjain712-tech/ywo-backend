const multer = require("multer");
const fs = require("fs");
const path = require("path");

// Multer Storage Config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const productId = req.body.product_code || `temp-${Date.now()}`;
    const uploadPath = path.join(__dirname, "../uploads/products", productId);

    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    // Store relative path for DB and absolute path for fs operations
    req.uploadFolder = uploadPath; // absolute path
    req.uploadFolderRelative = path.join("uploads", "products", productId); // relative path for DB
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${Date.now()}${ext}`);
  },
});

// File Filter
const fileFilter = (req, file, cb) => {
  if (file.fieldname.startsWith("image")) {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only images allowed"), false);
  } else if (file.fieldname === "video") {
    if (file.mimetype.startsWith("video/")) cb(null, true);
    else cb(new Error("Only videos allowed"), false);
  } else {
    cb(new Error("Invalid file field"), false);
  }
};

// Upload Handler
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024, files: 11 } // 10 images + 1 video
});

exports.uploadProductMedia = upload.fields([
  { name: "image1", maxCount: 1 },
  { name: "image2", maxCount: 1 },
  { name: "image3", maxCount: 1 },
  { name: "image4", maxCount: 1 },
  { name: "image5", maxCount: 1 },
  { name: "image6", maxCount: 1 },
  { name: "image7", maxCount: 1 },
  { name: "image8", maxCount: 1 },
  { name: "image9", maxCount: 1 },
  { name: "image10", maxCount: 1 },
  { name: "video", maxCount: 1 },
]);

