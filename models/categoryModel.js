const pool = require("../config/db");

// ✅ Create Category
exports.createCategory = async ({ name, description, slug, image_url, is_active }) => {
  const [result] = await pool.query(
    `INSERT INTO categories (name, description, slug, image_url, is_active)
     VALUES (?, ?, ?, ?, ?)`,
    [name, description || null, slug, image_url || null, is_active ?? true]
  );
  return result.insertId;
};

// ✅ Get all categories
exports.getAllCategories = async () => {
  const [rows] = await pool.query(
    `SELECT id, name, description, slug, image_url, is_active, created_at, updated_at
     FROM categories WHERE deleted_at IS NULL ORDER BY created_at DESC`
  );
  return rows;
};

// ✅ Get category by ID
exports.getCategoryById = async (id) => {
  const [rows] = await pool.query(
    `SELECT id, name, description, slug, image_url, is_active, created_at, updated_at
     FROM categories WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  return rows[0];
};

// ✅ Get category image only (for update/delete)
exports.getCategoryForImage = async (id) => {
  const [rows] = await pool.query(
    `SELECT image_url FROM categories WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  return rows[0];
};

// ✅ Update category
exports.updateCategory = async (id, { name, description, slug, image_url, is_active }) => {
  const [result] = await pool.query(
    `UPDATE categories 
     SET name = COALESCE(?, name),
         description = COALESCE(?, description),
         slug = COALESCE(?, slug),
         image_url = COALESCE(?, image_url),
         is_active = COALESCE(?, is_active),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL`,
    [name, description, slug, image_url, is_active, id]
  );
  return result.affectedRows > 0;
};

// ✅ Soft delete
exports.softDeleteCategory = async (id) => {
  const [result] = await pool.query(
    `UPDATE categories 
     SET deleted_at = CURRENT_TIMESTAMP 
     WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  return result.affectedRows > 0;
};

// Restore a soft-deleted category
exports.restoreCategory = async (id) => {
  const [result] = await pool.query(
    `UPDATE categories 
     SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NOT NULL`,
    [id]
  );
  return result.affectedRows > 0;
};

// Get all soft-deleted categories
exports.getDeletedCategories = async () => {
  const [rows] = await pool.query(
    `SELECT id, name, description, slug, image_url, is_active, deleted_at, created_at, updated_at
     FROM categories
     WHERE deleted_at IS NOT NULL
     ORDER BY deleted_at DESC`
  );
  return rows;
};
