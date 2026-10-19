const logger = require("../utils/logger");
const fs = require("fs");
const path = require("path");
const pool = require("../config/db");
const Product = require("../models/productModel");
const { cleanupUploadedFiles } = require("../middlewares/uploadProductMedia");
const slugify = require("../utils/slugify");
const multer = require('multer')

// Helper: safely delete folder recursively
const deleteFolder = (folderPath) => {
  if (fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true, force: true });
  }
};


// ================== EDITOR IMAGE HELPERS ==================
const extractEditorImages = (html = "") => {
  const regex = /<img[^>]+src="([^">]+)"/g;
  const images = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    images.push(match[1]);
  }
  return images;
};

const cleanupUnusedEditorImages = (productId, descriptionHtml) => {
  const dir = path.join(
    __dirname,
    "../uploads/editor-images",
    `product-${productId}`
  );

  if (!fs.existsSync(dir)) return;

  const usedImages = extractEditorImages(descriptionHtml);
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const fileUrl = `/uploads/editor-images/product-${productId}/${file}`;
    if (!usedImages.includes(fileUrl)) {
      fs.unlinkSync(path.join(dir, file));
    }
  });
};


// ================== ADMIN ==================


exports.uploadEditorImage = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!productId) {
      return res.status(400).json({ message: "Product ID required" });
    }

    const uploadDir = path.join(
      __dirname,
      "../uploads/editor-images",
      `product-${productId}`
    );

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const multer = require("multer");

    const storage = multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `editor-${Date.now()}${ext}`);
      }
    });

    const upload = multer({
      storage,
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith("image/")) {
          return cb(new Error("Only images allowed"));
        }
        cb(null, true);
      }
    }).single("image");

    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ message: err.message });

      const imageUrl = await Product.saveEditorImage(
        productId,
        req.file.filename
      );

      res.json({
        message: "Editor image uploaded",
        url: imageUrl
      });
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// ✅ Create product with variants & media
// CREATE PRODUCT
exports.createProduct = async (req, res) => {

    const conn = await pool.getConnection();


  try {
        await conn.beginTransaction();

    const {
      name,
      description,
      short_description,
      keywords,
      brand,
      category_id,
      is_new_arrival,
      is_on_sale,
      is_featured,
      is_free_shipping,
      gst_percent,
      cod_enabled,
      variants,
      youtube_videos
    } = req.body;

    const productCodEnabled =
      cod_enabled == null
        ? 1
        : (cod_enabled === "1" || cod_enabled === "true" ? 1 : 0);

    const productFreeShipping = is_free_shipping != null
      ? (is_free_shipping === "1" || is_free_shipping === "true" ? 1 : 0)
      : 0;

    if (!name || name.trim().length < 3) {
      cleanupUploadedFiles(req.files);
      return res.status(400).json({ message: "Product name is required (min 3 chars)" });
    }
    if (!brand || brand.trim().length < 2) {
      cleanupUploadedFiles(req.files);
      return res.status(400).json({ message: "Brand is required (min 2 chars)" });
    }

    // Parse variants if sent as JSON
    let parsedVariants = [];
    if (variants) {
      try {
        parsedVariants = typeof variants === "string" ? JSON.parse(variants) : variants;
        if (!Array.isArray(parsedVariants)) parsedVariants = [];
      } catch {
        parsedVariants = [];
      }
    }


    parsedVariants = parsedVariants.map(v => ({
      ...v,
      hsn_code: v.hsn_code || null,
      is_free_shipping:
        v.is_free_shipping === "1" || v.is_free_shipping === "true" ? 1 : 0,
      cod_enabled:
        v.cod_enabled === "0" || v.cod_enabled === 0 ? 0 : 1
    }));

    // 1) Create the product first (to get productId)
    const productId = await Product.createProduct({
      name,
      description,
      short_description,
      keywords,
      brand,
      category_id,
      is_new_arrival,
      is_on_sale,
      is_featured,
      is_free_shipping: productFreeShipping,
      cod_enabled: productCodEnabled,
      gst_percent,
    }, conn );

    // 2) Create/insert variants
    for (const v of parsedVariants) {
      try {
          const finalCodEnabled = productCodEnabled ? v.cod_enabled : 0;
         await Product.createVariant(
                {
                  product_id: productId,
                  ...v,
                  cod_enabled: finalCodEnabled
                },
                conn // 👈 IMPORTANT
              );
      } catch (variantErr) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({ message: `Variant error: ${variantErr.message}` });
      }
    }

    // ---------- MEDIA: move from temp-XXXX to product-{id} and insert rows ----------
    const finalFolder = `product-${productId}`;
    const baseDir = path.join(__dirname, "../uploads/products");
    const finalPath = path.join(baseDir, finalFolder);

    if (!fs.existsSync(finalPath)) fs.mkdirSync(finalPath, { recursive: true });

    // Multer saved into a temp folder like temp-<stamp> (from middleware)
    const tempFolder = req.uploadFolderName && req.uploadFolderName.startsWith("temp-")
      ? req.uploadFolderName
      : null;

    const moveIntoFinal = (fileObj) => {
      // fileObj.path is absolute current path
      const filename = path.basename(fileObj.path);
      const target = path.join(finalPath, filename);
      // Move file into final folder (rename is atomic on same disk)
      fs.renameSync(fileObj.path, target);
      // Return relative URL to save in DB
      return `/uploads/products/${finalFolder}/${filename}`;
    };

    // Save uploaded images (keep natural order; start sort from MAX+1 (Rule B))
    if (req.files?.images?.length) {
      const [[maxRow]] = await conn.query(
        `SELECT COALESCE(MAX(sort_order), 0) AS maxSort
         FROM product_media WHERE product_id = ?`,
        [productId]
      );
      let nextSort = Number(maxRow?.maxSort || 0) + 1;

      for (let i = 0; i < req.files.images.length; i++) {
        const mediaUrl = tempFolder ? moveIntoFinal(req.files.images[i]) 
                                    : `/uploads/products/${finalFolder}/${req.files.images[i].filename}`;
        await Product.addMedia({
          product_id: productId,
          media_type: "image",
          media_url: mediaUrl,
          sort_order: nextSort++
        }, conn);
      }
    }

    // Save uploaded video file
    if (req.files?.video?.length) {
      const videoFile = req.files.video[0];
      const mediaUrl = tempFolder ? moveIntoFinal(videoFile)
                                  : `/uploads/products/${finalFolder}/${videoFile.filename}`;
      await Product.addMedia({
        product_id: productId,
        media_type: "video",
        media_url: mediaUrl,
        video_source: "upload",
        sort_order: 999
      }, conn);
    }

    // Save YouTube video (single string)
if (youtube_videos && youtube_videos.trim() !== "") {
  await Product.addMedia({
    product_id: productId,
    media_type: "video",
    media_url: youtube_videos.trim(),
    video_source: "youtube",
    sort_order: 999
  }, conn);
}

    // -------------------------------
    // COMMIT
    // -------------------------------
    await conn.commit();


    // If a temp folder was used and is now empty, you can remove it safely
    // ALWAYS delete temp folder fully if exists (AFTER ALL MEDIA INSERT logic)
if (tempFolder) {
  const tempPath = path.join(baseDir, tempFolder);
  try {
    if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { recursive: true, force: true });
    }
  } catch (e) {
    logger.error("Failed to remove temp upload folder:", e.message);
  }
}

    res.status(201).json({ message: "Product created successfully", productId });
  } catch (err) {
     await conn.rollback();
    cleanupUploadedFiles(req.files);
    res.status(500).json({ message: "Error creating product", error: err.message });
  } finally {
    conn.release();
  }
};


exports.updateStockBulk = async (req, res) => {
  try {
    const { stock_list } = req.body;

    if (!Array.isArray(stock_list) || stock_list.length === 0) {
      return res.status(400).json({ message: "stock_list must be a non-empty array" });
    }

    await Product.updateVariantStockBulk(stock_list);

    res.json({ message: "Stock updated successfully" });

  } catch (err) {
    res.status(500).json({
      message: "Error updating stock in bulk",
      error: err.message
    });
  }
};





exports.updateProduct = async (req, res) => {
  const conn = await pool.getConnection();
  try {

     await conn.beginTransaction();
    const { id } = req.params;

    let {
      name,
      description,
      short_description,
      keywords,
      brand,
      category_id,
      is_new_arrival,
      is_on_sale,
      is_featured,
      is_free_shipping,
      gst_percent,
      cod_enabled,
      variants,
      youtube_videos,      // <-- single string URL
      replace_media        // <-- JSON text: [{"media_id":7}, {"media_id":12}, ...] (can include image and/or video media ids)
    } = req.body;

    // 1) Fetch product
    const product = await Product.getProductById(id, conn);
    if (!product) {
      cleanupUploadedFiles(req.files);
      return res.status(404).json({ message: "Product not found" });
    }

    const folderName = `product-${id}`;
    const baseDir = path.join(__dirname, "../uploads/products");
    const finalPath = path.join(baseDir, folderName);
    if (!fs.existsSync(finalPath)) fs.mkdirSync(finalPath, { recursive: true });

    // 2) Normalize booleans
    if (is_free_shipping != null) {
      is_free_shipping =
        is_free_shipping === "1" || is_free_shipping === "true" ? 1 : 0;
    }

     if (cod_enabled != null)
      cod_enabled = cod_enabled === "1" || cod_enabled === "true" ? 1 : 0;

    // 3) Update fields if provided
    const updateFields = {};
    if (name != null) updateFields.name = name;
    if (description != null) updateFields.description = description;
    if (short_description != null) updateFields.short_description = short_description;
    if (keywords != null) updateFields.keywords = keywords;
    if (brand != null) updateFields.brand = brand;
    if (category_id != null) updateFields.category_id = category_id;
    if (is_new_arrival != null) updateFields.is_new_arrival = is_new_arrival;
    if (is_on_sale != null) updateFields.is_on_sale = is_on_sale;
    if (is_featured != null) updateFields.is_featured = is_featured;
    if (is_free_shipping != null) updateFields.is_free_shipping = is_free_shipping;
    if (cod_enabled != null) updateFields.cod_enabled = cod_enabled;
    if (gst_percent != null) updateFields.gst_percent = gst_percent;

  if (Object.keys(updateFields).length > 0) {
  await Product.updateProduct(id, updateFields, conn);

  // 🧹 CLEAN UNUSED EDITOR IMAGES (ONLY IF DESCRIPTION UPDATED)
  if (updateFields.description) {
    cleanupUnusedEditorImages(id, updateFields.description);
  }
}


    // 4) Variants
    let parsedVariants = [];
    if (variants) {
      try {
        parsedVariants = typeof variants === "string" ? JSON.parse(variants) : variants;
        if (!Array.isArray(parsedVariants)) parsedVariants = [];
      } catch {
        parsedVariants = [];
      }
    }

    parsedVariants = parsedVariants.map(v => ({
      ...v,
       hsn_code: v.hsn_code || null,
is_free_shipping: Number(v.is_free_shipping) ? 1 : 0
    }));

// 1️⃣ Fetch existing variant IDs
const [existingVariants] = await conn.query(
  `SELECT id FROM product_variants WHERE product_id = ?`,
  [id]
);

const existingIds = existingVariants.map(v => Number(v.id));

// 2️⃣ Extract incoming variant IDs
const incomingIds = Array.isArray(parsedVariants)
  ? parsedVariants
      .filter(v => v.id)
      .map(v => Number(v.id))
  : [];

// 3️⃣ Find removed IDs
const removedIds = existingIds.filter(
  dbId => !incomingIds.includes(dbId)
);

// 4️⃣ Delete removed variants safely
if (removedIds.length > 0) {
  await conn.query(
    `DELETE FROM product_variants 
     WHERE product_id = ? AND id IN (?)`,
    [id, removedIds]
  );
}

    for (const v of parsedVariants) {
         if (cod_enabled === 0) v.cod_enabled = 0;
   
         if (v.id)
           await Product.updateVariant(v.id, v, conn);
         else
           await Product.createVariant({ product_id: id, ...v }, conn);
       }

    // ====================== MEDIA ======================
    // Parse replace_media (used for BOTH images and video)
    let replaceList = [];
    if (replace_media) {
      try {
        replaceList = typeof replace_media === "string" ? JSON.parse(replace_media) : replace_media;
        if (!Array.isArray(replaceList)) replaceList = [];
      } catch {
        replaceList = [];
      }
    }

    const imageFiles = req.files?.images || [];
    const videoFiles = req.files?.video || [];
    let imgIdx = 0;

    // Helper: safely delete a file path (media_url is stored like /uploads/products/xxx/filename.ext)
    const safeDelete = (relPath) => {
      try {
        if (!relPath) return;
        const abs = path.join(__dirname, "..", relPath);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch { /* noop */ }
    };

    // ---------- IMAGE REPLACE (pair replace_media ids -> image files IN ORDER) ----------
    // We only consume an image file when the media_id actually points to an IMAGE row
    if (replaceList.length && imageFiles.length) {
      for (let i = 0; i < replaceList.length && imgIdx < imageFiles.length; i++) {
        const mediaId = replaceList[i]?.media_id;
        if (!mediaId) continue;

        // Is this media id an image for this product?
        const [[oldImg]] = await conn.query(
          `SELECT id, media_url
             FROM product_media
            WHERE id=? AND product_id=? AND media_type='image'`,
          [mediaId, id]
        );
        if (!oldImg) continue;

        // Use next image file for this replacement
        const newFile = imageFiles[imgIdx++];
        if (!newFile) break;

        // Delete old physical file
        safeDelete(oldImg.media_url);

        // Move/keep new file (already stored by multer in final folder)
        const filename = path.basename(newFile.path);
        const newUrl = `/uploads/products/${folderName}/${filename}`;

        // Update SAME row (keep sort_order)
        await conn.query(`UPDATE product_media SET media_url=? WHERE id=?`, [newUrl, mediaId]);
      }
    }

    // ---------- APPEND NEW IMAGES (respect MAX=10) ----------
    const remainingNewImages = imageFiles.slice(imgIdx);
    if (remainingNewImages.length) {
      const [[imgCountRow]] = await conn.query(
        `SELECT COUNT(*) AS total FROM product_media WHERE product_id=? AND media_type='image'`,
        [id]
      );
      const existingCount = Number(imgCountRow?.total || 0);
      if (existingCount + remainingNewImages.length > 10) {
        // delete just-uploaded extras to keep FS clean
        cleanupUploadedFiles({ images: remainingNewImages });
        return res.status(400).json({ message: "You can only keep a maximum of 10 images per product" });
      }

      const [[maxRow]] = await conn.query(
        `SELECT COALESCE(MAX(sort_order), 0) AS maxSort
           FROM product_media
          WHERE product_id=?`,
        [id]
      );
      let nextSort = Number(maxRow?.maxSort || 0) + 1;

      for (const f of remainingNewImages) {
        const filename = path.basename(f.path);
        await Product.addMedia({
          product_id: id,
          media_type: "image",
          media_url: `/uploads/products/${folderName}/${filename}`,
          sort_order: nextSort++
        }, conn);
      }
    }

    // ====================== VIDEO (single allowed) ======================
    // We allow exactly one video row per product: either upload or youtube.
    // Conflict (both upload file and youtube url in same request) => 400.
    const youtubeStrProvided = typeof youtube_videos !== "undefined" && (youtube_videos || "").toString().trim().length > 0;
    if (videoFiles.length && youtubeStrProvided) {
      // Clean up uploaded video to avoid orphan
      cleanupUploadedFiles({ video: videoFiles });
      return res.status(400).json({ message: "You can only send one: either upload video OR YouTube URL" });
    }

    // Locate existing video row (any source)
    const [[existingVideo]] = await conn.query(
      `SELECT * FROM product_media WHERE product_id=? AND media_type='video' LIMIT 1`,
      [id]
    );

    // Is there a specific video target in replace_media?
    let replaceMediaVideoId = null;
    if (replaceList.length) {
      for (let i = 0; i < replaceList.length; i++) {
        const mId = replaceList[i]?.media_id;
        if (!mId) continue;
        const [[vrow]] = await conn.query(
          `SELECT id FROM product_media WHERE id=? AND product_id=? AND media_type='video'`,
          [mId, id]
        );
        if (vrow) { replaceMediaVideoId = vrow.id; break; }
      }
    }

    // Helper to resolve the row we will UPDATE (if any)
    const getVideoTargetId = () => {
      // priority 1: explicit replace_media video id
      if (replaceMediaVideoId) return replaceMediaVideoId;
      // priority 2: the single existing video row (since only one allowed)
      if (existingVideo) return existingVideo.id;
      // else no existing row -> we will INSERT
      return null;
    };

    // ---- Case A: uploaded video file ----
    if (videoFiles.length) {
      const videoFile = videoFiles[0];
      const filename = path.basename(videoFile.path);
      const newUrl = `/uploads/products/${folderName}/${filename}`;

      const targetId = getVideoTargetId();
      if (targetId) {
        // Fetch current row for cleanup decision
        const [[targetRow]] = await conn.query(
          `SELECT id, media_url, video_source FROM product_media WHERE id=? AND product_id=? AND media_type='video'`,
          [targetId, id]
        );
        if (targetRow && targetRow.video_source === "upload") safeDelete(targetRow.media_url);

        await conn.query(
          `UPDATE product_media SET media_url=?, video_source='upload' WHERE id=?`,
          [newUrl, targetId]
        );
      } else {
        // Insert new uploaded video row
        await Product.addMedia({
          product_id: id,
          media_type: "video",
          media_url: newUrl,
          video_source: "upload",
          sort_order: 999
        }, conn);
      }
    }

    // ---- Case B: YouTube URL (single string) ----
    if (typeof youtube_videos !== "undefined") {
      const yt = (youtube_videos || "").toString().trim();

      if (yt.length > 0) {
        const targetId = getVideoTargetId();

        if (targetId) {
          const [[targetRow]] = await conn.query(
            `SELECT id, media_url, video_source FROM product_media WHERE id=? AND product_id=? AND media_type='video'`,
            [targetId, id]
          );
          // if replacing an uploaded file with a YouTube link, delete the file
          if (targetRow && targetRow.video_source === "upload") safeDelete(targetRow.media_url);

          await conn.query(
            `UPDATE product_media SET media_url=?, video_source='youtube' WHERE id=?`,
            [yt, targetId]
          );
        } else {
          // No video row yet -> insert new YouTube row
          await Product.addMedia({
            product_id: id,
            media_type: "video",
            media_url: yt,
            video_source: "youtube",
            sort_order: 999
          }, conn);
        }
      }
      // If yt empty string: no-op (no delete-on-empty behavior)
    }
        await conn.commit();

    res.status(200).json({ message: "Product updated successfully" });
  } catch (err) {
    await conn.rollback();
    cleanupUploadedFiles(req.files);
    res.status(500).json({ message: "Error updating product", error: err.message });
  } finally {
    conn.release();
  }
};


exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid product ID" });

    const product = await Product.getProductById(id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    // 🔥 DELETE PRODUCT MEDIA FOLDER
    const folder = `product-${id}`;
    const folderPath = path.join(__dirname, "..", "uploads", "products", folder);
    deleteFolder(folderPath);

    // 🔥 DELETE EDITOR IMAGES FOLDER (ADD THIS LINE)
    const editorFolderPath = path.join(
      __dirname,
      "..",
      "uploads",
      "editor-images",
      `product-${id}`
    );
    deleteFolder(editorFolderPath);

    const deleted = await Product.deleteProduct(id);
    if (!deleted) return res.status(404).json({ message: "Product not found" });

    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting product", error: err.message });
  }
};



// ✅ Delete specific media
exports.deleteMedia = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid media ID" });

    const media = await Product.deleteMedia(id);
    if (!media) return res.status(404).json({ message: "Media not found" });

    if (media.media_source !== "youtube") {
      const filePath = path.join(__dirname, "..", media.media_url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    res.json({ message: "Media deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting media", error: err.message });
  }
};


exports.getProductMediaByProductId = async (req, res) => {
  try {
    const { id } = req.params;
    const media = await Product.getProductMediaByProductId(id);
    res.json(media);
  } catch (err) {
    res.status(500).json({ message: "Error fetching product media", error: err.message });
  }
}

// ================== USER ==================

// ✅ Get filtered products (search + filter + sort + pagination)
// exports.getFilteredProducts = async (req, res) => {
//   try {
//     const { category, brand, min_price, max_price, sort, search, page = 1, limit = 10 } = req.query;
//     if (isNaN(page) || isNaN(limit)) return res.status(400).json({ message: "Page and limit must be numbers" });

//     const offset = (parseInt(page) - 1) * parseInt(limit);
//     const products = await Product.getFilteredProducts({ category, brand, min_price, max_price, sort, search, limit, offset });

//     res.json({ page: parseInt(page), limit: parseInt(limit), count: products.length, products });
//   } catch (err) {
//     res.status(500).json({ message: "Error fetching products", error: err.message });
//   }
// };

/**
 * GET FILTERED PRODUCTS API
 */
exports.getFilteredProducts = async (req, res) => {
  try {
    const {
      category,
      brand,
      min_price,
      max_price,
      sort,
      search,
      is_new_arrival,
      page = 1,
      limit = 20
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    if (isNaN(pageNum) || isNaN(limitNum)) {
      return res.status(400).json({
        success: false,
        message: "Page and limit must be valid numbers"
      });
    }

    const offset = (pageNum - 1) * limitNum;

    const filters = {
      category,
      brand,
      min_price,
      max_price,
      sort,
      search,
      is_new_arrival
    };

    const [products, total] = await Promise.all([
      Product.getFilteredProducts({
        ...filters,
        limit: limitNum,
        offset
      }),
      Product.countFilteredProducts(filters)
    ]);

    res.status(200).json({
      success: true,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      products
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error fetching products",
      error: err.message
    });
  }
};


exports.getProductsNameAndId = async (req, res) => {
  try {
    const products = await Product.getProductsNameAndId();
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: "Error fetching products", error: err.message });
  }
}

exports.searchProducts = async (req, res) => {
    try {
        const { search, page = 1, limit = 100 } = req.query;

        if (!search || search.trim() === "") {
            return res.status(400).json({ message: "Search term is required" });
        }

        const searchTerm = search.trim();
        const parsedPage = parseInt(page);
        const parsedLimit = parseInt(limit);

        if (isNaN(parsedPage) || isNaN(parsedLimit) || parsedPage < 1 || parsedLimit < 1) {
            return res.status(400).json({ message: "Page and limit must be positive numbers" });
        }

        const offset = (parsedPage - 1) * parsedLimit;
        
        // Added tracing log: Check if the function starts and parameters are correct
        // logger.info(`[Search Trace] Starting search for term: ${searchTerm}, Limit: ${parsedLimit}, Offset: ${offset}`); 
        
        // 1. Fetch matching products for the current page
        const products = await Product.searchProducts({ 
            searchTerm, 
            limit: parsedLimit, 
            offset 
        });
        
        // Added tracing log: Check if the first database call succeeded
        // logger.info(`[Search Trace] Step 1 (Search) successful. Fetched ${products.length} products.`); 

        // 2. Get the total count of unique matching products
        const total = await Product.countSearchProducts(searchTerm);
        
        // Added tracing log: Check if the second database call succeeded
        // logger.info(`[Search Trace] Step 2 (Count) successful. Total unique products: ${total}`);
        
        const totalPages = Math.ceil(total / parsedLimit);

        res.json({ 
            page: parsedPage, 
            limit: parsedLimit, 
            total: total, 
            totalPages: totalPages, 
            count: products.length, 
            products 
        });

    } catch (err) {
        // Enhanced error logging to include the stack trace
        logger.error("Search Product API Error (500):", err.message); 
        logger.error(err.stack); // This helps trace the error back to the model/DB query
        res.status(500).json({ message: "Error during product search", error: err.message });
    }
};

exports.searchSuggestions = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim().length < 2) {
            return res.json({ suggestions: [] });
        }
        const suggestions = await Product.getSearchSuggestions(q.trim(), 8);
        res.json({ suggestions });
    } catch (err) {
        logger.error("Search Suggestions Error:", err.message);
        res.status(500).json({ message: "Error fetching suggestions", error: err.message });
    }
};

// ✅ Get single product with variants & media
exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid product ID" });

    const product = await Product.getProductById(id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    res.json(product);
  } catch (err) {
    res.status(500).json({ message: "Error fetching product", error: err.message });
  }
};

// ✅ Get all products full details (no filter)
exports.getAllProductsFull = async (req, res) => {
  try {
    const { page = 1, limit = 50, search = "" } = req.query;
    if (isNaN(page) || isNaN(limit)) return res.status(400).json({ message: "Page and limit must be numbers" });

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const products = await Product.getAllProductsFull({ limit, offset, search });

    const total = await Product.countAllProductsFull({ search });

    res.json({ page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit), count: products.length, products });
  } catch (err) {
    res.status(500).json({ message: "Error fetching all products", error: err.message });
  }
};

// ✅ Create Variant
exports.createVariant = async (req, res) => {
    const conn = await pool.getConnection();

  try {
        await conn.beginTransaction();

    const { productId } = req.params;
    const variantData = req.body;

    const variantId = await Product.createVariant({ product_id: productId, ...variantData }, conn);

        await conn.commit();
    res.status(201).json({ message: "Variant created successfully", variantId });
  } catch (err) {
        await conn.rollback();  
    res.status(400).json({ message: "Error creating variant", error: err.message });
  } finally {
    conn.release();
  }
};

exports.checkCodAvailability = async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Items are required" });
    }

    const variantIds = items.map(i => Number(i.variant_id));

    const [rows] = await pool.query(
      `
      SELECT 
        v.id AS variant_id,
        v.cod_enabled AS variant_cod,
        p.cod_enabled AS product_cod
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.id IN (?)
      `,
      [variantIds]
    );

    // ❌ If any item disallows COD → block COD
    const codAllowed = rows.every(
      r => r.variant_cod === 1 && r.product_cod === 1
    );

    return res.json({
      cod_allowed: codAllowed
    });

  } catch (err) {
    res.status(500).json({ message: "COD check failed", error: err.message });
  }
};

exports.getVariant = async (req, res) => {
  try {
    const { variantId } = req.params;

    const variant = await Product.getVariantById(variantId);
    if (!variant) {
      return res.status(404).json({ message: "Variant not found" });
    }

    res.status(200).json({
      message: "Variant fetched successfully",
      data: variant,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ✅ Update Variant
exports.updateVariant = async (req, res) => {
    const conn = await pool.getConnection();

  try {
        await conn.beginTransaction();

    const { id } = req.params;
    const fields = req.body;

     if (fields.cod_enabled != null)
      fields.cod_enabled = fields.cod_enabled === "1" || fields.cod_enabled === "true" ? 1 : 0;

    const updated = await Product.updateVariant(id, fields, conn);
    if (!updated) return res.status(404).json({ message: "Variant not found" });

     await conn.commit();
    res.json({ message: "Variant updated successfully" });
  } catch (err) {
        await conn.rollback();
    res.status(400).json({ message: "Error updating variant", error: err.message });
  } finally {
    conn.release();
  }
};

// ✅ Delete Variant
exports.deleteVariant = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await Product.deleteVariant(id);
    if (!deleted) return res.status(404).json({ message: "Variant not found" });

    res.json({ message: "Variant deleted successfully" });
  } catch (err) {
    res.status(400).json({ message: "Error deleting variant", error: err.message });
  }
};

// ✅ Get all variants
exports.getAllVariants = async (req, res) => {
  try {
    const variants = await Product.getAllVariants();
    res.json(variants);
  } catch (err) {
    res.status(500).json({ message: "Error fetching variants", error: err.message });
  }
};




// const fs = require("fs");
// const path = require("path");
// const pool = require("../config/db");
// const Product = require("../models/productModel");
// const { cleanupUploadedFiles } = require("../middlewares/uploadProductMedia");
// const slugify = require("../utils/slugify");
// const multer = require('multer')

// // Helper: safely delete folder recursively
// const deleteFolder = (folderPath) => {
//   if (fs.existsSync(folderPath)) {
//     fs.rmSync(folderPath, { recursive: true, force: true });
//   }
// };


// // ================== EDITOR IMAGE HELPERS ==================
// const extractEditorImages = (html = "") => {
//   const regex = /<img[^>]+src="([^">]+)"/g;
//   const images = [];
//   let match;
//   while ((match = regex.exec(html)) !== null) {
//     images.push(match[1]);
//   }
//   return images;
// };

// const cleanupUnusedEditorImages = (productId, descriptionHtml) => {
//   const dir = path.join(
//     __dirname,
//     "../uploads/editor-images",
//     `product-${productId}`
//   );

//   if (!fs.existsSync(dir)) return;

//   const usedImages = extractEditorImages(descriptionHtml);
//   const files = fs.readdirSync(dir);

//   files.forEach((file) => {
//     const fileUrl = `/uploads/editor-images/product-${productId}/${file}`;
//     if (!usedImages.includes(fileUrl)) {
//       fs.unlinkSync(path.join(dir, file));
//     }
//   });
// };


// // ================== ADMIN ==================


// exports.uploadEditorImage = async (req, res) => {
//   try {
//     const { productId } = req.params;
//     if (!productId) {
//       return res.status(400).json({ message: "Product ID required" });
//     }

//     const uploadDir = path.join(
//       __dirname,
//       "../uploads/editor-images",
//       `product-${productId}`
//     );

//     if (!fs.existsSync(uploadDir)) {
//       fs.mkdirSync(uploadDir, { recursive: true });
//     }

//     const multer = require("multer");

//     const storage = multer.diskStorage({
//       destination: uploadDir,
//       filename: (req, file, cb) => {
//         const ext = path.extname(file.originalname);
//         cb(null, `editor-${Date.now()}${ext}`);
//       }
//     });

//     const upload = multer({
//       storage,
//       fileFilter: (req, file, cb) => {
//         if (!file.mimetype.startsWith("image/")) {
//           return cb(new Error("Only images allowed"));
//         }
//         cb(null, true);
//       }
//     }).single("image");

//     upload(req, res, async (err) => {
//       if (err) return res.status(400).json({ message: err.message });

//       const imageUrl = await Product.saveEditorImage(
//         productId,
//         req.file.filename
//       );

//       res.json({
//         message: "Editor image uploaded",
//         url: imageUrl
//       });
//     });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };


// // ✅ Create product with variants & media
// // CREATE PRODUCT (TRANSACTION SAFE)
// exports.createProduct = async (req, res) => {
//   const conn = await pool.getConnection();

//   try {
//     await conn.beginTransaction();

//     const {
//       name,
//       description,
//       short_description,
//       keywords,
//       brand,
//       category_id,
//       is_new_arrival,
//       is_on_sale,
//       is_featured,
//       is_free_shipping,
//       gst_percent,
//       cod_enabled,
//       variants,
//       youtube_videos
//     } = req.body;

//     // -------------------------------
//     // NORMALIZE FLAGS (SCHEMA SAFE)
//     // -------------------------------
//     const productCodEnabled =
//       cod_enabled == null
//         ? 1
//         : (cod_enabled === "1" || cod_enabled === "true" ? 1 : 0);

//     const productFreeShipping =
//       is_free_shipping == null
//         ? 0
//         : (is_free_shipping === "1" || is_free_shipping === "true" ? 1 : 0);

//     // -------------------------------
//     // BASIC VALIDATION
//     // -------------------------------
//     if (!name || name.trim().length < 3) {
//       cleanupUploadedFiles(req.files);
//       return res.status(400).json({ message: "Product name is required (min 3 chars)" });
//     }

//     if (!brand || brand.trim().length < 2) {
//       cleanupUploadedFiles(req.files);
//       return res.status(400).json({ message: "Brand is required (min 2 chars)" });
//     }

//     // -------------------------------
//     // PARSE VARIANTS
//     // -------------------------------
//     let parsedVariants = [];
//     if (variants) {
//       try {
//         parsedVariants = typeof variants === "string" ? JSON.parse(variants) : variants;
//         if (!Array.isArray(parsedVariants)) parsedVariants = [];
//       } catch {
//         parsedVariants = [];
//       }
//     }

//     parsedVariants = parsedVariants.map(v => ({
//       ...v,
//       hsn_code: v.hsn_code || null,
//       is_free_shipping:
//         v.is_free_shipping === "1" || v.is_free_shipping === "true" ? 1 : 0,
//       cod_enabled:
//         v.cod_enabled === "0" || v.cod_enabled === 0 ? 0 : 1
//     }));

//     // -------------------------------
//     // 1️⃣ CREATE PRODUCT
//     // -------------------------------
//     const productId = await Product.createProduct(
//       {
//         name,
//         description,
//         short_description,
//         keywords,
//         brand,
//         category_id,
//         is_new_arrival,
//         is_on_sale,
//         is_featured,
//         is_free_shipping: productFreeShipping,
//         cod_enabled: productCodEnabled,
//         gst_percent
//       },
//       conn // 👈 IMPORTANT
//     );

//     // -------------------------------
//     // 2️⃣ CREATE VARIANTS
//     // -------------------------------
//     for (const v of parsedVariants) {
//       const finalCodEnabled = productCodEnabled ? v.cod_enabled : 0;

//       await Product.createVariant(
//         {
//           product_id: productId,
//           ...v,
//           cod_enabled: finalCodEnabled
//         },
//         conn // 👈 IMPORTANT
//       );
//     }

//     // -------------------------------
//     // MEDIA HANDLING
//     // -------------------------------
//     const finalFolder = `product-${productId}`;
//     const baseDir = path.join(__dirname, "../uploads/products");
//     const finalPath = path.join(baseDir, finalFolder);

//     if (!fs.existsSync(finalPath)) fs.mkdirSync(finalPath, { recursive: true });

//     const tempFolder =
//       req.uploadFolderName && req.uploadFolderName.startsWith("temp-")
//         ? req.uploadFolderName
//         : null;

//     const moveIntoFinal = (fileObj) => {
//       const filename = path.basename(fileObj.path);
//       const target = path.join(finalPath, filename);
//       fs.renameSync(fileObj.path, target);
//       return `/uploads/products/${finalFolder}/${filename}`;
//     };

//     // Images
//     if (req.files?.images?.length) {
//       const [[maxRow]] = await conn.query(
//         `SELECT COALESCE(MAX(sort_order), 0) AS maxSort
//          FROM product_media WHERE product_id = ?`,
//         [productId]
//       );

//       let nextSort = Number(maxRow?.maxSort || 0) + 1;

//       for (const img of req.files.images) {
//         const mediaUrl = tempFolder
//           ? moveIntoFinal(img)
//           : `/uploads/products/${finalFolder}/${img.filename}`;

//         await Product.addMedia(
//           {
//             product_id: productId,
//             media_type: "image",
//             media_url: mediaUrl,
//             sort_order: nextSort++
//           },
//           conn
//         );
//       }
//     }

//     // Uploaded video
//     if (req.files?.video?.length) {
//       const videoFile = req.files.video[0];
//       const mediaUrl = tempFolder
//         ? moveIntoFinal(videoFile)
//         : `/uploads/products/${finalFolder}/${videoFile.filename}`;

//       await Product.addMedia(
//         {
//           product_id: productId,
//           media_type: "video",
//           media_url: mediaUrl,
//           video_source: "upload",
//           sort_order: 999
//         },
//         conn
//       );
//     }

//     // YouTube video
//     if (youtube_videos && youtube_videos.trim() !== "") {
//       await Product.addMedia(
//         {
//           product_id: productId,
//           media_type: "video",
//           media_url: youtube_videos.trim(),
//           video_source: "youtube",
//           sort_order: 999
//         },
//         conn
//       );
//     }

//     // -------------------------------
//     // COMMIT
//     // -------------------------------
//     await conn.commit();

//     // Remove temp folder AFTER commit
//     if (tempFolder) {
//       const tempPath = path.join(baseDir, tempFolder);
//       if (fs.existsSync(tempPath)) {
//         fs.rmSync(tempPath, { recursive: true, force: true });
//       }
//     }

//     res.status(201).json({
//       message: "Product created successfully",
//       productId
//     });

//   } catch (err) {
//     await conn.rollback();
//     cleanupUploadedFiles(req.files);

//     res.status(500).json({
//       message: "Error creating product",
//       error: err.message
//     });
//   } finally {
//     conn.release();
//   }
// };



// exports.updateStockBulk = async (req, res) => {
//   try {
//     const { stock_list } = req.body;

//     if (!Array.isArray(stock_list) || stock_list.length === 0) {
//       return res.status(400).json({ message: "stock_list must be a non-empty array" });
//     }

//     await Product.updateVariantStockBulk(stock_list);

//     res.json({ message: "Stock updated successfully" });

//   } catch (err) {
//     res.status(500).json({
//       message: "Error updating stock in bulk",
//       error: err.message
//     });
//   }
// };


// exports.checkCodAvailability = async (req, res) => {
//   try {
//     const { items } = req.body;

//     if (!Array.isArray(items) || items.length === 0) {
//       return res.status(400).json({ message: "Items are required" });
//     }

//     const variantIds = items.map(i => Number(i.variant_id));

//     const [rows] = await pool.query(
//       `
//       SELECT 
//         v.id AS variant_id,
//         v.cod_enabled AS variant_cod,
//         p.cod_enabled AS product_cod
//       FROM product_variants v
//       JOIN products p ON p.id = v.product_id
//       WHERE v.id IN (?)
//       `,
//       [variantIds]
//     );

//     // ❌ If any item disallows COD → block COD
//     const codAllowed = rows.every(
//       r => r.variant_cod === 1 && r.product_cod === 1
//     );

//     return res.json({
//       cod_allowed: codAllowed
//     });

//   } catch (err) {
//     res.status(500).json({ message: "COD check failed", error: err.message });
//   }
// };






// exports.updateProduct = async (req, res) => {
//   const conn = await pool.getConnection();

//   try {
//     await conn.beginTransaction();

//     const { id } = req.params;

//     let {
//       name,
//       description,
//       short_description,
//       keywords,
//       brand,
//       category_id,
//       is_new_arrival,
//       is_on_sale,
//       is_featured,
//       is_free_shipping,
//       gst_percent,
//       cod_enabled,
//       variants,
//       youtube_videos,
//       replace_media
//     } = req.body;

//     // 1️⃣ Fetch product
//     const product = await Product.getProductById(id, conn);
//     if (!product) {
//       cleanupUploadedFiles(req.files);
//       return res.status(404).json({ message: "Product not found" });
//     }

//     const folderName = `product-${id}`;
//     const baseDir = path.join(__dirname, "../uploads/products");
//     const finalPath = path.join(baseDir, folderName);
//     if (!fs.existsSync(finalPath)) fs.mkdirSync(finalPath, { recursive: true });

//     // 2️⃣ Normalize flags
//     if (is_free_shipping != null)
//       is_free_shipping = is_free_shipping === "1" || is_free_shipping === "true" ? 1 : 0;

//     if (cod_enabled != null)
//       cod_enabled = cod_enabled === "1" || cod_enabled === "true" ? 1 : 0;

//     // 3️⃣ Update product fields
//     const updateFields = {};
//     if (name != null) updateFields.name = name;
//     if (description != null) updateFields.description = description;
//     if (short_description != null) updateFields.short_description = short_description;
//     if (keywords != null) updateFields.keywords = keywords;
//     if (brand != null) updateFields.brand = brand;
//     if (category_id != null) updateFields.category_id = category_id;
//     if (is_new_arrival != null) updateFields.is_new_arrival = is_new_arrival;
//     if (is_on_sale != null) updateFields.is_on_sale = is_on_sale;
//     if (is_featured != null) updateFields.is_featured = is_featured;
//     if (is_free_shipping != null) updateFields.is_free_shipping = is_free_shipping;
//     if (cod_enabled != null) updateFields.cod_enabled = cod_enabled;
//     if (gst_percent != null) updateFields.gst_percent = gst_percent;

//     if (Object.keys(updateFields).length) {
//       await Product.updateProduct(id, updateFields, conn);
//       if (updateFields.description)
//         cleanupUnusedEditorImages(id, updateFields.description);
//     }

//     // 4️⃣ Variants
//     let parsedVariants = [];
//     if (variants) {
//       try {
//         parsedVariants = typeof variants === "string" ? JSON.parse(variants) : variants;
//       } catch {
//         parsedVariants = [];
//       }
//     }

//     for (const v of parsedVariants) {
//       if (cod_enabled === 0) v.cod_enabled = 0;

//       if (v.id)
//         await Product.updateVariant(v.id, v, conn);
//       else
//         await Product.createVariant({ product_id: id, ...v }, conn);
//     }

//     // 5️⃣ Media replace
//     let replaceList = [];
//     if (replace_media) {
//       try {
//         replaceList = typeof replace_media === "string" ? JSON.parse(replace_media) : replace_media;
//       } catch {
//         replaceList = [];
//       }
//     }

//     const safeDelete = (rel) => {
//       if (!rel) return;
//       const abs = path.join(__dirname, "..", rel);
//       if (fs.existsSync(abs)) fs.unlinkSync(abs);
//     };

//     // Replace images
//     const images = req.files?.images || [];
//     let imgIdx = 0;

//     for (const r of replaceList) {
//       if (!images[imgIdx]) break;

//       const [[old]] = await conn.query(
//         `SELECT * FROM product_media WHERE id=? AND product_id=? AND media_type='image'`,
//         [r.media_id, id]
//       );
//       if (!old) continue;

//       safeDelete(old.media_url);
//       const filename = path.basename(images[imgIdx++].path);
//       await conn.query(
//         `UPDATE product_media SET media_url=? WHERE id=?`,
//         [`/uploads/products/${folderName}/${filename}`, r.media_id]
//       );
//     }

//     // Append new images (max 10)
//     const remaining = images.slice(imgIdx);
//     if (remaining.length) {
//       const [[cnt]] = await conn.query(
//         `SELECT COUNT(*) total FROM product_media WHERE product_id=? AND media_type='image'`,
//         [id]
//       );
//       if (cnt.total + remaining.length > 10)
//         throw new Error("Max 10 images allowed");

//       const [[max]] = await conn.query(
//         `SELECT COALESCE(MAX(sort_order),0) m FROM product_media WHERE product_id=?`,
//         [id]
//       );
//       let sort = max.m + 1;

//       for (const f of remaining) {
//         const filename = path.basename(f.path);
//         await Product.addMedia({
//           product_id: id,
//           media_type: "image",
//           media_url: `/uploads/products/${folderName}/${filename}`,
//           sort_order: sort++
//         }, conn);
//       }
//     }

//     // 6️⃣ Video (upload OR youtube)
//     const videoFiles = req.files?.video || [];

//     if (videoFiles.length && youtube_videos)
//       throw new Error("Only one video source allowed");

//     const [[existingVideo]] = await conn.query(
//       `SELECT * FROM product_media WHERE product_id=? AND media_type='video' LIMIT 1`,
//       [id]
//     );

//     if (videoFiles.length) {
//       const filename = path.basename(videoFiles[0].path);
//       if (existingVideo?.video_source === "upload")
//         safeDelete(existingVideo.media_url);

//       if (existingVideo)
//         await conn.query(
//           `UPDATE product_media SET media_url=?, video_source='upload' WHERE id=?`,
//           [`/uploads/products/${folderName}/${filename}`, existingVideo.id]
//         );
//       else
//         await Product.addMedia({
//           product_id: id,
//           media_type: "video",
//           media_url: `/uploads/products/${folderName}/${filename}`,
//           video_source: "upload",
//           sort_order: 999
//         }, conn);
//     }

//     if (youtube_videos) {
//       if (existingVideo?.video_source === "upload")
//         safeDelete(existingVideo.media_url);

//       if (existingVideo)
//         await conn.query(
//           `UPDATE product_media SET media_url=?, video_source='youtube' WHERE id=?`,
//           [youtube_videos.trim(), existingVideo.id]
//         );
//       else
//         await Product.addMedia({
//           product_id: id,
//           media_type: "video",
//           media_url: youtube_videos.trim(),
//           video_source: "youtube",
//           sort_order: 999
//         }, conn);
//     }

//     await conn.commit();
//     res.json({ message: "Product updated successfully" });

//   } catch (err) {
//     await conn.rollback();
//     cleanupUploadedFiles(req.files);
//     res.status(500).json({ message: "Error updating product", error: err.message });
//   } finally {
//     conn.release();
//   }
// };



// // ✅ Update Variant
// exports.updateVariant = async (req, res) => {
//   const conn = await pool.getConnection();

//   try {
//     await conn.beginTransaction();

//     const { id } = req.params;
//     const fields = { ...req.body };

//     if (fields.cod_enabled != null)
//       fields.cod_enabled = fields.cod_enabled === "1" || fields.cod_enabled === "true" ? 1 : 0;

//     const updated = await Product.updateVariant(id, fields, conn);
//     if (!updated) throw new Error("Variant not found");

//     await conn.commit();
//     res.json({ message: "Variant updated successfully" });

//   } catch (err) {
//     await conn.rollback();
//     res.status(400).json({ message: "Error updating variant", error: err.message });
//   } finally {
//     conn.release();
//   }
// };







// // ✅ Delete product
// // exports.deleteProduct = async (req, res) => {
// //   try {
// //     const { id } = req.params;
// //     if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid product ID" });

// //     const product = await Product.getProductById(id);
// //     if (!product) return res.status(404).json({ message: "Product not found" });

// //     const folder = `product-${id}`;
// //     const folderPath = path.join(__dirname, "..", "uploads", "products", folder);
// //     deleteFolder(folderPath);

// //     const deleted = await Product.deleteProduct(id);
// //     if (!deleted) return res.status(404).json({ message: "Product not found" });

// //     res.json({ message: "Product deleted successfully" });
// //   } catch (err) {
// //     res.status(500).json({ message: "Error deleting product", error: err.message });
// //   }
// // };


// // ================== ADMIN ==================

// // ... createProduct
// // ... updateProduct
// // ... other admin handlers

// exports.deleteProduct = async (req, res) => {
//   try {
//     const { id } = req.params;
//     if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid product ID" });

//     const product = await Product.getProductById(id);
//     if (!product) return res.status(404).json({ message: "Product not found" });

//     // 🔥 DELETE PRODUCT MEDIA FOLDER
//     const folder = `product-${id}`;
//     const folderPath = path.join(__dirname, "..", "uploads", "products", folder);
//     deleteFolder(folderPath);

//     // 🔥 DELETE EDITOR IMAGES FOLDER (ADD THIS LINE)
//     const editorFolderPath = path.join(
//       __dirname,
//       "..",
//       "uploads",
//       "editor-images",
//       `product-${id}`
//     );
//     deleteFolder(editorFolderPath);

//     const deleted = await Product.deleteProduct(id);
//     if (!deleted) return res.status(404).json({ message: "Product not found" });

//     res.json({ message: "Product deleted successfully" });
//   } catch (err) {
//     res.status(500).json({ message: "Error deleting product", error: err.message });
//   }
// };



// // ✅ Delete specific media
// exports.deleteMedia = async (req, res) => {
//   try {
//     const { id } = req.params;
//     if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid media ID" });

//     const media = await Product.deleteMedia(id);
//     if (!media) return res.status(404).json({ message: "Media not found" });

//     if (media.media_source !== "youtube") {
//       const filePath = path.join(__dirname, "..", media.media_url);
//       if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
//     }

//     res.json({ message: "Media deleted successfully" });
//   } catch (err) {
//     res.status(500).json({ message: "Error deleting media", error: err.message });
//   }
// };


// exports.getProductMediaByProductId = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const media = await Product.getProductMediaByProductId(id);
//     res.json(media);
//   } catch (err) {
//     res.status(500).json({ message: "Error fetching product media", error: err.message });
//   }
// }

// // ================== USER ==================

// // ✅ Get filtered products (search + filter + sort + pagination)
// // exports.getFilteredProducts = async (req, res) => {
// //   try {
// //     const { category, brand, min_price, max_price, sort, search, page = 1, limit = 10 } = req.query;
// //     if (isNaN(page) || isNaN(limit)) return res.status(400).json({ message: "Page and limit must be numbers" });

// //     const offset = (parseInt(page) - 1) * parseInt(limit);
// //     const products = await Product.getFilteredProducts({ category, brand, min_price, max_price, sort, search, limit, offset });

// //     res.json({ page: parseInt(page), limit: parseInt(limit), count: products.length, products });
// //   } catch (err) {
// //     res.status(500).json({ message: "Error fetching products", error: err.message });
// //   }
// // };

// /**
//  * GET FILTERED PRODUCTS API
//  */
// exports.getFilteredProducts = async (req, res) => {
//   try {
//     const {
//       category,
//       brand,
//       min_price,
//       max_price,
//       sort,
//       search,
//       is_new_arrival,
//       page = 1,
//       limit = 20
//     } = req.query;

//     const pageNum = parseInt(page);
//     const limitNum = parseInt(limit);

//     if (isNaN(pageNum) || isNaN(limitNum)) {
//       return res.status(400).json({
//         success: false,
//         message: "Page and limit must be valid numbers"
//       });
//     }

//     const offset = (pageNum - 1) * limitNum;

//     const filters = {
//       category,
//       brand,
//       min_price,
//       max_price,
//       sort,
//       search,
//       is_new_arrival
//     };

//     const [products, total] = await Promise.all([
//       Product.getFilteredProducts({
//         ...filters,
//         limit: limitNum,
//         offset
//       }),
//       Product.countFilteredProducts(filters)
//     ]);

//     res.status(200).json({
//       success: true,
//       page: pageNum,
//       limit: limitNum,
//       total,
//       totalPages: Math.ceil(total / limitNum),
//       products
//     });

//   } catch (err) {
//     res.status(500).json({
//       success: false,
//       message: "Error fetching products",
//       error: err.message
//     });
//   }
// };


// exports.getProductsNameAndId = async (req, res) => {
//   try {
//     const products = await Product.getProductsNameAndId();
//     res.json(products);
//   } catch (err) {
//     res.status(500).json({ message: "Error fetching products", error: err.message });
//   }
// }

// exports.searchProducts = async (req, res) => {
//     try {
//         const { search, page = 1, limit = 100 } = req.query;

//         if (!search || search.trim() === "") {
//             return res.status(400).json({ message: "Search term is required" });
//         }

//         const searchTerm = search.trim();
//         const parsedPage = parseInt(page);
//         const parsedLimit = parseInt(limit);

//         if (isNaN(parsedPage) || isNaN(parsedLimit) || parsedPage < 1 || parsedLimit < 1) {
//             return res.status(400).json({ message: "Page and limit must be positive numbers" });
//         }

//         const offset = (parsedPage - 1) * parsedLimit;
        
//         // Added tracing log: Check if the function starts and parameters are correct
//         // logger.info(`[Search Trace] Starting search for term: ${searchTerm}, Limit: ${parsedLimit}, Offset: ${offset}`); 
        
//         // 1. Fetch matching products for the current page
//         const products = await Product.searchProducts({ 
//             searchTerm, 
//             limit: parsedLimit, 
//             offset 
//         });
        
//         // Added tracing log: Check if the first database call succeeded
//         // logger.info(`[Search Trace] Step 1 (Search) successful. Fetched ${products.length} products.`); 

//         // 2. Get the total count of unique matching products
//         const total = await Product.countSearchProducts(searchTerm);
        
//         // Added tracing log: Check if the second database call succeeded
//         // logger.info(`[Search Trace] Step 2 (Count) successful. Total unique products: ${total}`);
        
//         const totalPages = Math.ceil(total / parsedLimit);

//         res.json({ 
//             page: parsedPage, 
//             limit: parsedLimit, 
//             total: total, 
//             totalPages: totalPages, 
//             count: products.length, 
//             products 
//         });

//     } catch (err) {
//         // Enhanced error logging to include the stack trace
//         logger.error("Search Product API Error (500):", err.message); 
//         logger.error(err.stack); // This helps trace the error back to the model/DB query
//         res.status(500).json({ message: "Error during product search", error: err.message });
//     }
// };


// // ✅ Get single product with variants & media
// exports.getProductById = async (req, res) => {
//   try {
//     const { id } = req.params;
//     if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid product ID" });

//     const product = await Product.getProductById(id);
//     if (!product) return res.status(404).json({ message: "Product not found" });

//     res.json(product);
//   } catch (err) {
//     res.status(500).json({ message: "Error fetching product", error: err.message });
//   }
// };

// // ✅ Get all products full details (no filter)
// exports.getAllProductsFull = async (req, res) => {
//   try {
//     const { page = 1, limit = 50 } = req.query;
//     if (isNaN(page) || isNaN(limit)) return res.status(400).json({ message: "Page and limit must be numbers" });

//     const offset = (parseInt(page) - 1) * parseInt(limit);
//     const products = await Product.getAllProductsFull({ limit, offset });

//     const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM products WHERE is_active = 1`);

//     res.json({ page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit), count: products.length, products });
//   } catch (err) {
//     res.status(500).json({ message: "Error fetching all products", error: err.message });
//   }
// };

// // ✅ Create Variant
// exports.createVariant = async (req, res) => {
//   const conn = await pool.getConnection();

//   try {
//     await conn.beginTransaction();

//     const { productId } = req.params;
//     const variantId = await Product.createVariant(
//       { product_id: productId, ...req.body },
//       conn
//     );

//     await conn.commit();
//     res.status(201).json({ message: "Variant created successfully", variantId });

//   } catch (err) {
//     await conn.rollback();
//     res.status(400).json({ message: "Error creating variant", error: err.message });
//   } finally {
//     conn.release();
//   }
// };




// exports.getVariant = async (req, res) => {
//   try {
//     const { variantId } = req.params;

//     const variant = await Product.getVariantById(variantId);
//     if (!variant) {
//       return res.status(404).json({ message: "Variant not found" });
//     }

//     res.status(200).json({
//       message: "Variant fetched successfully",
//       data: variant,
//     });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };



// // ✅ Delete Variant
// exports.deleteVariant = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const deleted = await Product.deleteVariant(id);
//     if (!deleted) return res.status(404).json({ message: "Variant not found" });

//     res.json({ message: "Variant deleted successfully" });
//   } catch (err) {
//     res.status(400).json({ message: "Error deleting variant", error: err.message });
//   }
// };

// // ✅ Get all variants
// exports.getAllVariants = async (req, res) => {
//   try {
//     const variants = await Product.getAllVariants();
//     res.json(variants);
//   } catch (err) {
//     res.status(500).json({ message: "Error fetching variants", error: err.message });
//   }
// };

// exports.updateProduct = async (req, res) => {
//   const conn = await pool.getConnection();

//   try {
//     await conn.beginTransaction();

//     const { id } = req.params;

//     let {
//       name,
//       description,
//       short_description,
//       keywords,
//       brand,
//       category_id,
//       is_new_arrival,
//       is_on_sale,
//       is_featured,
//       is_free_shipping,
//       gst_percent,
//       cod_enabled,
//       variants,
//       youtube_videos,
//       replace_media
//     } = req.body;

//     // 1️⃣ Fetch product
//     const product = await Product.getProductById(id, conn);
//     if (!product) {
//       cleanupUploadedFiles(req.files);
//       return res.status(404).json({ message: "Product not found" });
//     }

//     const folderName = `product-${id}`;
//     const baseDir = path.join(__dirname, "../uploads/products");
//     const finalPath = path.join(baseDir, folderName);
//     if (!fs.existsSync(finalPath)) fs.mkdirSync(finalPath, { recursive: true });

//     // 2️⃣ Normalize flags
//     if (is_free_shipping != null)
//       is_free_shipping = is_free_shipping === "1" || is_free_shipping === "true" ? 1 : 0;

//     if (cod_enabled != null)
//       cod_enabled = cod_enabled === "1" || cod_enabled === "true" ? 1 : 0;

//     // 3️⃣ Update product fields
//     const updateFields = {};
//     if (name != null) updateFields.name = name;
//     if (description != null) updateFields.description = description;
//     if (short_description != null) updateFields.short_description = short_description;
//     if (keywords != null) updateFields.keywords = keywords;
//     if (brand != null) updateFields.brand = brand;
//     if (category_id != null) updateFields.category_id = category_id;
//     if (is_new_arrival != null) updateFields.is_new_arrival = is_new_arrival;
//     if (is_on_sale != null) updateFields.is_on_sale = is_on_sale;
//     if (is_featured != null) updateFields.is_featured = is_featured;
//     if (is_free_shipping != null) updateFields.is_free_shipping = is_free_shipping;
//     if (cod_enabled != null) updateFields.cod_enabled = cod_enabled;
//     if (gst_percent != null) updateFields.gst_percent = gst_percent;

//     if (Object.keys(updateFields).length) {
//       await Product.updateProduct(id, updateFields, conn);
//       if (updateFields.description)
//         cleanupUnusedEditorImages(id, updateFields.description);
//     }

//     // 4️⃣ Variants
//     let parsedVariants = [];
//     if (variants) {
//       try {
//         parsedVariants = typeof variants === "string" ? JSON.parse(variants) : variants;
//       } catch {
//         parsedVariants = [];
//       }
//     }

//     for (const v of parsedVariants) {
//       if (cod_enabled === 0) v.cod_enabled = 0;

//       if (v.id)
//         await Product.updateVariant(v.id, v, conn);
//       else
//         await Product.createVariant({ product_id: id, ...v }, conn);
//     }

//     // 5️⃣ Media replace
//     let replaceList = [];
//     if (replace_media) {
//       try {
//         replaceList = typeof replace_media === "string" ? JSON.parse(replace_media) : replace_media;
//       } catch {
//         replaceList = [];
//       }
//     }

//     const safeDelete = (rel) => {
//       if (!rel) return;
//       const abs = path.join(__dirname, "..", rel);
//       if (fs.existsSync(abs)) fs.unlinkSync(abs);
//     };

//     // Replace images
//     const images = req.files?.images || [];
//     let imgIdx = 0;

//     for (const r of replaceList) {
//       if (!images[imgIdx]) break;

//       const [[old]] = await conn.query(
//         `SELECT * FROM product_media WHERE id=? AND product_id=? AND media_type='image'`,
//         [r.media_id, id]
//       );
//       if (!old) continue;

//       safeDelete(old.media_url);
//       const filename = path.basename(images[imgIdx++].path);
//       await conn.query(
//         `UPDATE product_media SET media_url=? WHERE id=?`,
//         [`/uploads/products/${folderName}/${filename}`, r.media_id]
//       );
//     }

//     // Append new images (max 10)
//     const remaining = images.slice(imgIdx);
//     if (remaining.length) {
//       const [[cnt]] = await conn.query(
//         `SELECT COUNT(*) total FROM product_media WHERE product_id=? AND media_type='image'`,
//         [id]
//       );
//       if (cnt.total + remaining.length > 10)
//         throw new Error("Max 10 images allowed");

//       const [[max]] = await conn.query(
//         `SELECT COALESCE(MAX(sort_order),0) m FROM product_media WHERE product_id=?`,
//         [id]
//       );
//       let sort = max.m + 1;

//       for (const f of remaining) {
//         const filename = path.basename(f.path);
//         await Product.addMedia({
//           product_id: id,
//           media_type: "image",
//           media_url: `/uploads/products/${folderName}/${filename}`,
//           sort_order: sort++
//         }, conn);
//       }
//     }

//     // 6️⃣ Video (upload OR youtube)
//     const videoFiles = req.files?.video || [];

//     if (videoFiles.length && youtube_videos)
//       throw new Error("Only one video source allowed");

//     const [[existingVideo]] = await conn.query(
//       `SELECT * FROM product_media WHERE product_id=? AND media_type='video' LIMIT 1`,
//       [id]
//     );

//     if (videoFiles.length) {
//       const filename = path.basename(videoFiles[0].path);
//       if (existingVideo?.video_source === "upload")
//         safeDelete(existingVideo.media_url);

//       if (existingVideo)
//         await conn.query(
//           `UPDATE product_media SET media_url=?, video_source='upload' WHERE id=?`,
//           [`/uploads/products/${folderName}/${filename}`, existingVideo.id]
//         );
//       else
//         await Product.addMedia({
//           product_id: id,
//           media_type: "video",
//           media_url: `/uploads/products/${folderName}/${filename}`,
//           video_source: "upload",
//           sort_order: 999
//         }, conn);
//     }

//     if (youtube_videos) {
//       if (existingVideo?.video_source === "upload")
//         safeDelete(existingVideo.media_url);

//       if (existingVideo)
//         await conn.query(
//           `UPDATE product_media SET media_url=?, video_source='youtube' WHERE id=?`,
//           [youtube_videos.trim(), existingVideo.id]
//         );
//       else
//         await Product.addMedia({
//           product_id: id,
//           media_type: "video",
//           media_url: youtube_videos.trim(),
//           video_source: "youtube",
//           sort_order: 999
//         }, conn);
//     }

//     await conn.commit();
//     res.json({ message: "Product updated successfully" });

//   } catch (err) {
//     await conn.rollback();
//     cleanupUploadedFiles(req.files);
//     res.status(500).json({ message: "Error updating product", error: err.message });
//   } finally {
//     conn.release();
//   }
// };



// // ✅ Update Variant
// exports.updateVariant = async (req, res) => {
//   const conn = await pool.getConnection();

//   try {
//     await conn.beginTransaction();

//     const { id } = req.params;
//     const fields = { ...req.body };

//     if (fields.cod_enabled != null)
//       fields.cod_enabled = fields.cod_enabled === "1" || fields.cod_enabled === "true" ? 1 : 0;

//     const updated = await Product.updateVariant(id, fields, conn);
//     if (!updated) throw new Error("Variant not found");

//     await conn.commit();
//     res.json({ message: "Variant updated successfully" });

//   } catch (err) {
//     await conn.rollback();
//     res.status(400).json({ message: "Error updating variant", error: err.message });
//   } finally {
//     conn.release();
//   }
// };







// // ✅ Delete product
// // exports.deleteProduct = async (req, res) => {
// //   try {
// //     const { id } = req.params;
// //     if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid product ID" });

// //     const product = await Product.getProductById(id);
// //     if (!product) return res.status(404).json({ message: "Product not found" });

// //     const folder = `product-${id}`;
// //     const folderPath = path.join(__dirname, "..", "uploads", "products", folder);
// //     deleteFolder(folderPath);

// //     const deleted = await Product.deleteProduct(id);
// //     if (!deleted) return res.status(404).json({ message: "Product not found" });

// //     res.json({ message: "Product deleted successfully" });
// //   } catch (err) {
// //     res.status(500).json({ message: "Error deleting product", error: err.message });
// //   }
// // };


// // ================== ADMIN ==================

// // ... createProduct
// // ... updateProduct
// // ... other admin handlers

// exports.deleteProduct = async (req, res) => {
//   try {
//     const { id } = req.params;
//     if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid product ID" });

//     const product = await Product.getProductById(id);
//     if (!product) return res.status(404).json({ message: "Product not found" });

//     // 🔥 DELETE PRODUCT MEDIA FOLDER
//     const folder = `product-${id}`;
//     const folderPath = path.join(__dirname, "..", "uploads", "products", folder);
//     deleteFolder(folderPath);

//     // 🔥 DELETE EDITOR IMAGES FOLDER (ADD THIS LINE)
//     const editorFolderPath = path.join(
//       __dirname,
//       "..",
//       "uploads",
//       "editor-images",
//       `product-${id}`
//     );
//     deleteFolder(editorFolderPath);

//     const deleted = await Product.deleteProduct(id);
//     if (!deleted) return res.status(404).json({ message: "Product not found" });

//     res.json({ message: "Product deleted successfully" });
//   } catch (err) {
//     res.status(500).json({ message: "Error deleting product", error: err.message });
//   }
// };



// // ✅ Delete specific media
// exports.deleteMedia = async (req, res) => {
//   try {
//     const { id } = req.params;
//     if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid media ID" });

//     const media = await Product.deleteMedia(id);
//     if (!media) return res.status(404).json({ message: "Media not found" });

//     if (media.media_source !== "youtube") {
//       const filePath = path.join(__dirname, "..", media.media_url);
//       if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
//     }

//     res.json({ message: "Media deleted successfully" });
//   } catch (err) {
//     res.status(500).json({ message: "Error deleting media", error: err.message });
//   }
// };


// exports.getProductMediaByProductId = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const media = await Product.getProductMediaByProductId(id);
//     res.json(media);
//   } catch (err) {
//     res.status(500).json({ message: "Error fetching product media", error: err.message });
//   }
// }

// // ================== USER ==================

// // ✅ Get filtered products (search + filter + sort + pagination)
// // exports.getFilteredProducts = async (req, res) => {
// //   try {
// //     const { category, brand, min_price, max_price, sort, search, page = 1, limit = 10 } = req.query;
// //     if (isNaN(page) || isNaN(limit)) return res.status(400).json({ message: "Page and limit must be numbers" });

// //     const offset = (parseInt(page) - 1) * parseInt(limit);
// //     const products = await Product.getFilteredProducts({ category, brand, min_price, max_price, sort, search, limit, offset });

// //     res.json({ page: parseInt(page), limit: parseInt(limit), count: products.length, products });
// //   } catch (err) {
// //     res.status(500).json({ message: "Error fetching products", error: err.message });
// //   }
// // };

// /**
//  * GET FILTERED PRODUCTS API
//  */
// exports.getFilteredProducts = async (req, res) => {
//   try {
//     const {
//       category,
//       brand,
//       min_price,
//       max_price,
//       sort,
//       search,
//       is_new_arrival,
//       page = 1,
//       limit = 20
//     } = req.query;

//     const pageNum = parseInt(page);
//     const limitNum = parseInt(limit);

//     if (isNaN(pageNum) || isNaN(limitNum)) {
//       return res.status(400).json({
//         success: false,
//         message: "Page and limit must be valid numbers"
//       });
//     }

//     const offset = (pageNum - 1) * limitNum;

//     const filters = {
//       category,
//       brand,
//       min_price,
//       max_price,
//       sort,
//       search,
//       is_new_arrival
//     };

//     const [products, total] = await Promise.all([
//       Product.getFilteredProducts({
//         ...filters,
//         limit: limitNum,
//         offset
//       }),
//       Product.countFilteredProducts(filters)
//     ]);

//     res.status(200).json({
//       success: true,
//       page: pageNum,
//       limit: limitNum,
//       total,
//       totalPages: Math.ceil(total / limitNum),
//       products
//     });

//   } catch (err) {
//     res.status(500).json({
//       success: false,
//       message: "Error fetching products",
//       error: err.message
//     });
//   }
// };


// exports.getProductsNameAndId = async (req, res) => {
//   try {
//     const products = await Product.getProductsNameAndId();
//     res.json(products);
//   } catch (err) {
//     res.status(500).json({ message: "Error fetching products", error: err.message });
//   }
// }

// exports.searchProducts = async (req, res) => {
//     try {
//         const { search, page = 1, limit = 100 } = req.query;

//         if (!search || search.trim() === "") {
//             return res.status(400).json({ message: "Search term is required" });
//         }

//         const searchTerm = search.trim();
//         const parsedPage = parseInt(page);
//         const parsedLimit = parseInt(limit);

//         if (isNaN(parsedPage) || isNaN(parsedLimit) || parsedPage < 1 || parsedLimit < 1) {
//             return res.status(400).json({ message: "Page and limit must be positive numbers" });
//         }

//         const offset = (parsedPage - 1) * parsedLimit;
        
//         // Added tracing log: Check if the function starts and parameters are correct
//         // logger.info(`[Search Trace] Starting search for term: ${searchTerm}, Limit: ${parsedLimit}, Offset: ${offset}`); 
        
//         // 1. Fetch matching products for the current page
//         const products = await Product.searchProducts({ 
//             searchTerm, 
//             limit: parsedLimit, 
//             offset 
//         });
        
//         // Added tracing log: Check if the first database call succeeded
//         // logger.info(`[Search Trace] Step 1 (Search) successful. Fetched ${products.length} products.`); 

//         // 2. Get the total count of unique matching products
//         const total = await Product.countSearchProducts(searchTerm);
        
//         // Added tracing log: Check if the second database call succeeded
//         // logger.info(`[Search Trace] Step 2 (Count) successful. Total unique products: ${total}`);
        
//         const totalPages = Math.ceil(total / parsedLimit);

//         res.json({ 
//             page: parsedPage, 
//             limit: parsedLimit, 
//             total: total, 
//             totalPages: totalPages, 
//             count: products.length, 
//             products 
//         });

//     } catch (err) {
//         // Enhanced error logging to include the stack trace
//         logger.error("Search Product API Error (500):", err.message); 
//         logger.error(err.stack); // This helps trace the error back to the model/DB query
//         res.status(500).json({ message: "Error during product search", error: err.message });
//     }
// };


// // ✅ Get single product with variants & media
// exports.getProductById = async (req, res) => {
//   try {
//     const { id } = req.params;
//     if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid product ID" });

//     const product = await Product.getProductById(id);
//     if (!product) return res.status(404).json({ message: "Product not found" });

//     res.json(product);
//   } catch (err) {
//     res.status(500).json({ message: "Error fetching product", error: err.message });
//   }
// };

// // ✅ Get all products full details (no filter)
// exports.getAllProductsFull = async (req, res) => {
//   try {
//     const { page = 1, limit = 50 } = req.query;
//     if (isNaN(page) || isNaN(limit)) return res.status(400).json({ message: "Page and limit must be numbers" });

//     const offset = (parseInt(page) - 1) * parseInt(limit);
//     const products = await Product.getAllProductsFull({ limit, offset });

//     const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM products WHERE is_active = 1`);

//     res.json({ page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit), count: products.length, products });
//   } catch (err) {
//     res.status(500).json({ message: "Error fetching all products", error: err.message });
//   }
// };

// // ✅ Create Variant
// exports.createVariant = async (req, res) => {
//   const conn = await pool.getConnection();

//   try {
//     await conn.beginTransaction();

//     const { productId } = req.params;
//     const variantId = await Product.createVariant(
//       { product_id: productId, ...req.body },
//       conn
//     );

//     await conn.commit();
//     res.status(201).json({ message: "Variant created successfully", variantId });

//   } catch (err) {
//     await conn.rollback();
//     res.status(400).json({ message: "Error creating variant", error: err.message });
//   } finally {
//     conn.release();
//   }
// };




// exports.getVariant = async (req, res) => {
//   try {
//     const { variantId } = req.params;

//     const variant = await Product.getVariantById(variantId);
//     if (!variant) {
//       return res.status(404).json({ message: "Variant not found" });
//     }

//     res.status(200).json({
//       message: "Variant fetched successfully",
//       data: variant,
//     });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };



// // ✅ Delete Variant
// exports.deleteVariant = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const deleted = await Product.deleteVariant(id);
//     if (!deleted) return res.status(404).json({ message: "Variant not found" });

//     res.json({ message: "Variant deleted successfully" });
//   } catch (err) {
//     res.status(400).json({ message: "Error deleting variant", error: err.message });
//   }
// };

// // ✅ Get all variants
// exports.getAllVariants = async (req, res) => {
//   try {
//     const variants = await Product.getAllVariants();
//     res.json(variants);
//   } catch (err) {
//     res.status(500).json({ message: "Error fetching variants", error: err.message });
//   }
// };
