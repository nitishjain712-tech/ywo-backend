const pool = require("../config/db");

// ✅ Create Banner
exports.createBanner = async ({ banner_name, banner_image, is_active }) => {
  const [result] = await pool.query(
    `INSERT INTO banners (banner_name, banner_image, is_active)
     VALUES (?, ?, ?)`,
    [banner_name, banner_image, is_active ?? true]
  );
  return result.insertId;
};

// ✅ Get all banners
exports.getAllBanners = async () => {
  const [rows] = await pool.query(
    `SELECT id, banner_name, banner_image, is_active, created_at, updated_at
     FROM banners ORDER BY created_at DESC`
  );
  return rows;
};


exports.getAllActiveBanners = async () => {
  const [rows] = await pool.query(
    `SELECT id, banner_name, banner_image, is_active, created_at, updated_at
FROM banners
WHERE is_active = 1
ORDER BY created_at DESC`
  );
  return rows;
};

// ✅ Get banner by ID
exports.getBannerById = async (id) => {
  const [rows] = await pool.query(
    `SELECT id, banner_name, banner_image, is_active, created_at, updated_at
     FROM banners WHERE id = ?`,
    [id]
  );
  return rows[0];
};

// ✅ Get banner image (for delete/update)
exports.getBannerForImage = async (id) => {
  const [rows] = await pool.query(
    `SELECT banner_image FROM banners WHERE id = ?`,
    [id]
  );
  return rows[0];
};

// ✅ Update banner
exports.updateBanner = async (id, { banner_name, banner_image, is_active }) => {
  const [result] = await pool.query(
    `UPDATE banners 
     SET banner_name = COALESCE(?, banner_name),
         banner_image = COALESCE(?, banner_image),
         is_active = COALESCE(?, is_active),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [banner_name, banner_image, is_active, id]
  );
  return result.affectedRows > 0;
};

// ✅ Delete banner (hard delete)
exports.deleteBanner = async (id) => {
  const [result] = await pool.query(
    `DELETE FROM banners WHERE id = ?`,
    [id]
  );
  return result.affectedRows > 0;
};
