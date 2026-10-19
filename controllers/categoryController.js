const logger = require("../utils/logger");
const fs = require("fs");
const path = require("path");
const Category = require("../models/categoryModel");
const slugify = require("../utils/slugify");

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

// ✅ Create Category
exports.createCategory = async (req, res) => {
  try {
    const { name, description, is_active } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ message: "Category name is required (min 2 chars)" });
    }

    const slug = slugify(name);
    const image_url = req.file ? `/uploads/categories/${req.file.filename}` : null;

    const categoryId = await Category.createCategory({
      name,
      description,
      slug,
      image_url,
      is_active: is_active !== undefined ? !!is_active : true,
    });

    res.status(201).json({ message: "Category created successfully", id: categoryId });
  } catch (err) {
    logger.error("Error creating category:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// ✅ Get all categories
exports.getCategories = async (req, res) => {
  try {
    const categories = await Category.getAllCategories();
    res.json(categories);
  } catch (err) {
    logger.error("Error fetching categories:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// ✅ Get single category
exports.getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid category ID" });

    const category = await Category.getCategoryById(id);
    if (!category) return res.status(404).json({ message: "Category not found" });

    res.json(category);
  } catch (err) {
    logger.error("Error fetching category:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// ✅ Update Category
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, is_active } = req.body;

    if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid category ID" });

    const slug = name ? slugify(name) : undefined;
    const oldCategory = await Category.getCategoryForImage(id);
    if (!oldCategory) return res.status(404).json({ message: "Category not found" });

    let image_url = oldCategory.image_url;
    if (req.file) {
      if (oldCategory.image_url) deleteFile(oldCategory.image_url);
      image_url = `/uploads/categories/${req.file.filename}`;
    }

    const success = await Category.updateCategory(id, {
      name,
      description,
      slug,
      image_url,
      is_active,
    });

    if (!success) return res.status(400).json({ message: "Category not updated" });

    res.json({ message: "Category updated successfully" });
  } catch (err) {
    logger.error("Error updating category:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// ✅ Delete Category
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid category ID" });

    const category = await Category.getCategoryForImage(id);
    if (!category) return res.status(404).json({ message: "Category not found" });

    const success = await Category.softDeleteCategory(id);
    if (!success) return res.status(400).json({ message: "Category not deleted" });

    if (category.image_url) deleteFile(category.image_url);

    res.json({ message: "Category deleted successfully" });
  } catch (err) {
    logger.error("Error deleting category:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

exports.restoreCategory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    const success = await Category.restoreCategory(id);
    if (!success) return res.status(404).json({ message: "Category not found or already active" });

    res.json({ message: "Category restored successfully" });
  } catch (err) {
    logger.error("Error restoring category:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getDeletedCategories = async (req, res) => {
  try {
    const deletedCategories = await Category.getDeletedCategories();
    res.json(deletedCategories);
  } catch (err) {
    logger.error("Error fetching deleted categories:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};
