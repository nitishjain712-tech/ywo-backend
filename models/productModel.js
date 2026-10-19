
const pool = require("../config/db");

const getDB = (conn) => conn || pool;

// ================== VALIDATION HELPERS ==================

exports.getMediaById = async (media_id) => {
  const [[row]] = await pool.query(`SELECT * FROM product_media WHERE id = ? LIMIT 1`, [media_id]);
  return row;
};

exports.getMaxSortOrderByProductId = async (product_id) => {
  const [[row]] = await pool.query(`SELECT COALESCE(MAX(sort_order),0) AS maxSort FROM product_media WHERE product_id = ?`, [product_id]);
  return row.maxSort;
};

exports.updateMediaUrl = async (media_id, url) => {
  await pool.query(`UPDATE product_media SET media_url = ? WHERE id = ?`, [url, media_id]);
  return true;
};


const validateProductData = ({ name, brand, description, short_description, is_free_shipping }) => {
  if (!name || typeof name !== "string" || name.trim().length < 3) {
    throw new Error("Product name is required and must be at least 3 characters");
  }
  if (!brand || typeof brand !== "string" || brand.trim().length < 2) {
    throw new Error("Brand is required and must be at least 2 characters");
  }
  // if (description && description.length > 2000) {
  //   throw new Error("Description is too long (max 2000 chars)");
  // }
  if (short_description && short_description.length > 2000) {
    throw new Error("Short description is too long (max 2000 chars)");
  }
  if (is_free_shipping != null && ![0, 1, true, false].includes(is_free_shipping)) {
    throw new Error("is_free_shipping must be a boolean (true/false or 0/1)");
  }
};


const validateVariantData = ({ sku, mrp, price, stock, length, width, height, weight, is_free_shipping }) => {
  if (!sku || typeof sku !== "string" || sku.trim().length < 3) {
    throw new Error("SKU is required and must be at least 3 characters");
  }
  if (!mrp || isNaN(mrp) || mrp <= 0) {
    throw new Error("MRP must be a positive number");
  }
  if (!price || isNaN(price) || price <= 0) {
    throw new Error("Price must be a positive number");
  }
  if (price > mrp) {
    throw new Error("Price cannot be greater than MRP");
  }
  if (stock != null && (isNaN(stock) || stock < 0)) {
    throw new Error("Stock must be a non-negative number");
  }

  [length, width, height, weight].forEach((val) => {
    if (val != null && (isNaN(val) || val < 0)) {
      throw new Error("Length, width, height, and weight must be non-negative numbers");
    }
  });

  if (is_free_shipping != null && ![0, 1, true, false].includes(is_free_shipping)) {
    throw new Error("is_free_shipping must be a boolean (true/false or 0/1)");
  }
};

exports.getVariantById = async (variantId) => {
  try {
    if (!variantId || isNaN(variantId)) throw new Error("Invalid variant ID");

    // Fetch variant + product details
    const [rows] = await pool.query(
      `
      SELECT 
        v.id,
        v.product_id,
        v.sku,
        v.hsn_code,
        v.variant_name,
        v.mrp,
        v.price,
        v.stock,
        v.length,
        v.width,
        v.height,
        v.weight,
        v.is_default,
        v.is_free_shipping,
        ROUND(((v.mrp - v.price)/v.mrp)*100, 2) AS discount_percentage,
        p.name AS product_name,
        p.brand AS product_brand,
        p.is_free_shipping AS product_free_shipping,
        p.is_on_sale,
        p.is_new_arrival,
        p.is_featured,
        p.category_id
      FROM product_variants v
      INNER JOIN products p ON v.product_id = p.id
      WHERE v.id = ?
      `,
      [variantId]
    );

    if (!rows.length) return null;
    const variant = rows[0];

    // Fetch associated media (images/videos)

    return {
      ...variant
    };
  } catch (err) {
    throw new Error("Error fetching variant by ID: " + err.message);
  }
};

exports.getProductsNameAndId = async () => {
  try {
    const [rows] = await pool.query(`SELECT id, name FROM products`);
    return rows;
  } catch (err) {
    throw new Error("Error fetching products: " + err.message);
  }
};


exports.updateProductAvgRating = async (product_id) => {
  const conn = await pool.getConnection();
  try {
    // Calculate average rating
    const [rows] = await conn.query(
      `SELECT AVG(rating) AS avg_rating
       FROM reviews
       WHERE product_id = ? AND status != 'REJECTED'`,
      [product_id]
    );

    // Safely convert to number (0 if null)
    const avg = Number(rows[0]?.avg_rating) || 0;

    // Update product table
    await conn.query(
      `UPDATE products SET avg_rating = ? WHERE id = ?`,
      [avg.toFixed(2), product_id]
    );

  } finally {
    conn.release();
  }
};


exports.updateVariantStockBulk = async (stockList) => {
  if (!Array.isArray(stockList) || stockList.length === 0) {
    throw new Error("Invalid stock list");
  }

  // Validate each entry
  for (const item of stockList) {
    if (!item.id || isNaN(item.id)) {
      throw new Error(`Invalid variant id: ${item.id}`);
    }

    if (item.stock == null || isNaN(item.stock)) {
      throw new Error(`Invalid stock value for variant ${item.id}`);
    }

    if (item.stock < 0) {
      throw new Error(`Stock cannot be negative for variant ${item.id}`);
    }
  }

  // Remove duplicates by ID
  const uniqueIds = [...new Set(stockList.map(v => Number(v.id)))];

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Verify all variant IDs exist
    const [existing] = await conn.query(
      `SELECT id FROM product_variants WHERE id IN (${uniqueIds.join(",")})`
    );

    if (existing.length !== uniqueIds.length) {
      throw new Error("Some variant IDs do not exist");
    }

    // Build CASE WHEN
    const cases = stockList
      .map(v => `WHEN ${v.id} THEN ${v.stock}`)
      .join(" ");

    const sql = `
      UPDATE product_variants
      SET stock = CASE id
        ${cases}
      END
      WHERE id IN (${uniqueIds.join(",")});
    `;

    await conn.query(sql);
    await conn.commit();

    return true;
  } catch (err) {
    await conn.rollback();
    throw new Error("Bulk stock update failed: " + err.message);
  } finally {
    conn.release();
  }
};



const validateMediaData = ({ media_type, media_url }) => {
  const allowedTypes = ["image", "video"];
  if (!allowedTypes.includes(media_type)) {
    throw new Error("Invalid media type (allowed: image, video)");
  }
  if (!media_url || typeof media_url !== "string") {
    throw new Error("Media URL is required");
  }
};

// ================== ADMIN QUERIES ==================

// ✅ Create Product
exports.createProduct = async (data, conn = null) => {
  try {

    const db = getDB(conn);

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
      cod_enabled
    } = data;

    validateProductData({ name, description, short_description, brand, is_free_shipping, cod_enabled, gst_percent });

    const codValue = cod_enabled == null ? 1 : Number(cod_enabled) ? 1 : 0;

    const [result] = await db.query(
      `INSERT INTO products 
        (name, description, short_description, keywords, brand, category_id, 
         is_new_arrival, is_on_sale, is_featured, is_free_shipping, cod_enabled, gst_percent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description || null,
        short_description || null,
        keywords || null,
        brand,
        category_id || null,
        Number(is_new_arrival) ? 1 : 0,
        Number(is_on_sale) ? 1 : 0,
        Number(is_featured) ? 1 : 0,
        Number(is_free_shipping) ? 1 : 0,
        codValue,
        gst_percent || 0,
      ]
    );

    return result.insertId;
  } catch (err) {
    throw new Error("Error creating product: " + err.message);
  }
};

// ================== EDITOR IMAGE ==================
exports.saveEditorImage = async (productId, filename) => {
  return `/uploads/editor-images/product-${productId}/${filename}`;
};


// ✅ Create Variant
exports.createVariant = async (data, conn = null) => {
  try {

    const db = getDB(conn);
    const {
      product_id,
      sku,
      hsn_code,
      variant_name,
      mrp,
      price,
      stock,
      is_default,
      length,
      width,
      height,
      weight,
      is_free_shipping,
      cod_enabled
    } = data;
    // Validate variant including dimensions and free shipping
    validateVariantData({ sku, mrp, price, stock, length, width, height, weight, is_free_shipping });

    // Ensure product exists
    const [[product]] = await db.query(`SELECT id FROM products WHERE id = ?`, [product_id]);
    if (!product) throw new Error("Product not found");

    // Ensure SKU is unique
    const [[existing]] = await db.query(`SELECT id FROM product_variants WHERE sku = ?`, [sku]);
    if (existing) throw new Error("SKU already exists");

    const [result] = await db.query(
      `INSERT INTO product_variants 
  (product_id, sku, hsn_code, variant_name, mrp, price, stock, is_default, length, width, height, weight, is_free_shipping, cod_enabled)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
      [
        product_id,
        sku,
        hsn_code || null,
        variant_name || null,
        mrp,
        price,
        stock || 0,
        is_default ? 1 : 0,
        length || null,
        width || null,
        height || null,
        weight || null,
        Number(is_free_shipping) ? 1 : 0,
        cod_enabled == null ? 0 : Number(cod_enabled) ? 1 : 0
      ]
    );

    return result.insertId;
  } catch (err) {
    throw new Error("Error creating variant: " + err.message);
  }
};


// ✅ Update Media
exports.updateMedia = async (id, { media_url, video_source }) => {
  try {
    const [[media]] = await pool.query(`SELECT * FROM product_media WHERE id = ?`, [id]);
    if (!media) return null;

    const fields = [];
    const values = [];

    if (media_url) {
      fields.push(`media_url=?`);
      values.push(media_url);
    }

    if (video_source !== undefined) {
      fields.push(`video_source=?`);
      values.push(video_source);
    }

    if (!fields.length) return media; // nothing to update

    values.push(id);

    await pool.query(`UPDATE product_media SET ${fields.join(", ")} WHERE id=?`, values);

    return true;
  } catch (err) {
    throw new Error("Error updating media: " + err.message);
  }
};


// ✅ Add Media
exports.addMedia = async (
  { product_id, media_type, media_url, sort_order, video_source },
  conn = null
) => {
  try {
    const db = conn || pool;

    validateMediaData({ media_type, media_url });

    const [[product]] = await db.query(
      `SELECT id FROM products WHERE id = ?`,
      [product_id]
    );

    if (!product) throw new Error("Product not found");

    const videoSrc =
      media_type === "video" && video_source ? video_source : null;

    const [result] = await db.query(
      `INSERT INTO product_media 
       (product_id, media_type, media_url, video_source, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [product_id, media_type, media_url, videoSrc, sort_order || 1]
    );

    return result.insertId;
  } catch (err) {
    throw new Error("Error adding media: " + err.message);
  }
};


// ✅ Delete Media
exports.deleteMedia = async (id) => {
  try {
    const [[media]] = await pool.query(`SELECT * FROM product_media WHERE id = ?`, [id]);
    if (!media) return null;

    await pool.query(`DELETE FROM product_media WHERE id = ?`, [id]);

    // media object now includes video_source for cleanup or logging
    return media;
  } catch (err) {
    throw new Error("Error deleting media: " + err.message);
  }
};


// ✅ Delete ALL Media (used for replace on update)
exports.deleteAllMediaByProductId = async (product_id) => {
  try {
    // Deletes all media (images and videos, including video_source) for the product
    await pool.query(`DELETE FROM product_media WHERE product_id = ?`, [product_id]);
    return true;
  } catch (err) {
    throw new Error("Error deleting all media: " + err.message);
  }
};

exports.getProductMediaByProductId = async (product_id) => {
  try {
    const [result] = await pool.query(`SELECT * FROM product_media WHERE product_id = ? ORDER BY sort_order ASC`, [product_id]);
    return result;
  } catch (err) {
    throw new Error("Error fetching product media: " + err.message);
  }
}


// ✅ Update Product
exports.updateProduct = async (id, fields, conn = null) => {
  try {

    const db = getDB(conn);

    if (!id) throw new Error("Product ID required");
    if (!fields || Object.keys(fields).length === 0) throw new Error("No fields to update");
    // remove gst_type if mistakenly passed
    delete fields.gst_type;
    if (fields.cod_enabled != null)
      fields.cod_enabled = Number(fields.cod_enabled) ? 1 : 0;

    validateProductData(fields);



    const updates = Object.keys(fields).map(k => `${k} = ?`).join(", ");
    const values = [...Object.values(fields), id];

    const [result] = await db.query(
      `UPDATE products SET ${updates}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );

    // 🔥 Enforce COD rule
    if (fields.cod_enabled === 0) {
      await db.query(
        `UPDATE product_variants SET cod_enabled = 0 WHERE product_id = ?`,
        [id]
      );
    }

    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error updating product: " + err.message);
  }
};


exports.updateVariant = async (id, fields, conn = null) => {
  try {
    if (!id) throw new Error("Variant ID required");
    if (!fields || Object.keys(fields).length === 0) throw new Error("No fields to update");

    const db = getDB(conn);

    if (fields.cod_enabled != null) {
      fields.cod_enabled = Number(fields.cod_enabled) ? 1 : 0;

      const [[row]] = await db.query(
        `SELECT p.cod_enabled
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE v.id = ?`,
        [id]
      );

      if (!row) throw new Error("Variant not found");

      if (row.cod_enabled === 0 && fields.cod_enabled === 1)
        throw new Error("Cannot enable COD for variant when product COD is disabled");
    }

    // Validate relevant fields
    const {
      sku, mrp, price, stock,
      length, width, height, weight,
      is_free_shipping, cod_enabled
    } = fields;

    if (
      sku !== undefined || mrp !== undefined || price !== undefined || stock !== undefined ||
      length !== undefined || width !== undefined || height !== undefined || weight !== undefined ||
      is_free_shipping !== undefined || cod_enabled !== undefined
    ) {
      validateVariantData(fields);
    }

    const updates = Object.keys(fields).map(k => `${k} = ?`).join(", ");
    const values = [...Object.values(fields), id];

    const [result] = await db.query(
      `UPDATE product_variants
     SET ${updates}, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
      values
    );

    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error updating variant: " + err.message);
  }
};




// ✅ Delete Product
exports.deleteProduct = async (id) => {
  try {
    if (!id) throw new Error("Product ID required");

    // Delete all child records first: media (images & videos including video_source) and variants (including dimensions & free shipping)
    await pool.query(`DELETE FROM product_media WHERE product_id = ?`, [id]);
    await pool.query(`DELETE FROM product_variants WHERE product_id = ?`, [id]);

    const [result] = await pool.query(`DELETE FROM products WHERE id = ?`, [id]);
    return result.affectedRows > 0;
  } catch (err) {
    throw new Error("Error deleting product: " + err.message);
  }
};


// ================== USER QUERIES ==================

// ✅ Get Filtered Products
// exports.getFilteredProducts = async ({ category, brand, min_price, max_price, sort, search, limit, offset }) => {
//   try {
//     let query = `SELECT 
//   p.id, p.name, p.brand, p.keywords, p.description, p.short_description,
//   p.is_free_shipping, p.gst_percent, p.is_on_sale, p.is_featured,
//   v.price, v.mrp,
//   ROUND(((v.mrp - v.price) / v.mrp) * 100, 2) AS discount_percentage,
//   m.media_url, m.video_source
// FROM products p
// LEFT JOIN (
//   SELECT product_id, MIN(price) AS price, MIN(mrp) AS mrp
//   FROM product_variants
//   GROUP BY product_id
// ) v ON p.id = v.product_id
// LEFT JOIN product_media m ON p.id = m.product_id AND m.sort_order = 1
// WHERE p.is_active = 1`;
//     const values = [];

//     if (category) {
//       query += " AND p.category_id = ?";
//       values.push(category);
//     }
//     if (brand) {
//       query += " AND p.brand = ?";
//       values.push(brand);
//     }
//     if (min_price) {
//       query += " AND v.price >= ?";
//       values.push(min_price);
//     }
//     if (max_price) {
//       query += " AND v.price <= ?";
//       values.push(max_price);
//     }
//     if (search) {
//       query += " AND (p.name LIKE ? OR p.description LIKE ? OR p.short_description LIKE ? OR p.keywords LIKE ?)";
//       values.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
//     }

//     switch (sort) {
//       case "price_asc":
//         query += " ORDER BY v.price ASC"; break;
//       case "price_desc":
//         query += " ORDER BY v.price DESC"; break;
//       case "discount_desc":
//         query += " ORDER BY discount_percentage DESC"; break;
//       case "newest":
//       default:
//         query += " ORDER BY p.created_at DESC";
//     }

//     if (limit) {
//       query += " LIMIT ?";
//       values.push(parseInt(limit));
//       if (offset) {
//         query += " OFFSET ?";
//         values.push(parseInt(offset));
//       }
//     }

//     const [rows] = await pool.query(query, values);
//     return rows;
//   } catch (err) {
//     throw new Error("Error fetching products: " + err.message);
//   }
// };


exports.getFilteredProducts = async ({
  category,
  brand,
  min_price,
  max_price,
  sort,
  search,
  is_new_arrival,
  limit,
  offset
}) => {
  try {
    let query = `
      SELECT 
        p.id,
        p.name,
        p.brand,
        p.keywords,
        p.description,
        p.short_description,
        p.is_free_shipping,
        p.gst_percent,
        p.is_on_sale,
        p.is_featured,
        p.is_new_arrival,
        p.category_id,
        v.price,
        v.mrp,
        ROUND(((v.mrp - v.price) / v.mrp) * 100, 2) AS discount_percentage,
        m.media_url,
        m.video_source
      FROM products p
      LEFT JOIN (
        SELECT product_id, MIN(price) AS price, MIN(mrp) AS mrp
        FROM product_variants
        GROUP BY product_id
      ) v ON p.id = v.product_id
      LEFT JOIN product_media m 
        ON p.id = m.product_id AND m.sort_order = 1
      WHERE p.is_active = 1
    `;

    const values = [];

    if (category) {
      const categoryList = String(category).split(",").map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      if (categoryList.length > 0) {
        query += ` AND p.category_id IN (${categoryList.map(() => "?").join(",")})`;
        values.push(...categoryList);
      }
    }

    if (brand) {
      const brandList = String(brand).split(",").map(b => b.trim().toLowerCase()).filter(Boolean);
      if (brandList.length > 0) {
        query += ` AND LOWER(TRIM(p.brand)) IN (${brandList.map(() => "?").join(",")})`;
        values.push(...brandList);
      }
    }

    if (is_new_arrival !== undefined) {
      query += " AND p.is_new_arrival = ?";
      values.push(is_new_arrival);
    }

    if (min_price) {
      query += " AND v.price >= ?";
      values.push(min_price);
    }

    if (max_price) {
      query += " AND v.price <= ?";
      values.push(max_price);
    }

    if (search) {
      query += `
        AND (
          p.name LIKE ? OR
          p.keywords LIKE ? OR
          p.short_description LIKE ?
        )
      `;
      values.push(
        `%${search}%`,
        `%${search}%`,
        `%${search}%`
      );
    }

    switch (sort) {
      case "price_asc":
        query += " ORDER BY v.price ASC";
        break;
      case "price_desc":
        query += " ORDER BY v.price DESC";
        break;
      case "discount_desc":
        query += " ORDER BY discount_percentage DESC";
        break;
      default:
        query += " ORDER BY p.created_at DESC";
    }

    if (limit !== undefined && offset !== undefined) {
      query += " LIMIT ? OFFSET ?";
      values.push(Number(limit), Number(offset));
    }

    const [rows] = await pool.query(query, values);
    return rows;
  } catch (err) {
    throw new Error("Error fetching filtered products: " + err.message);
  }
};

/**
 * COUNT FILTERED PRODUCTS (FOR PAGINATION)
 */
exports.countFilteredProducts = async ({
  category,
  brand,
  min_price,
  max_price,
  search,
  is_new_arrival
}) => {
  try {
    let query = `
      SELECT COUNT(DISTINCT p.id) AS total
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id
      WHERE p.is_active = 1
    `;

    const values = [];

    if (category) {
      const categoryList = String(category).split(",").map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      if (categoryList.length > 0) {
        query += ` AND p.category_id IN (${categoryList.map(() => "?").join(",")})`;
        values.push(...categoryList);
      }
    }

    if (brand) {
      const brandList = String(brand).split(",").map(b => b.trim().toLowerCase()).filter(Boolean);
      if (brandList.length > 0) {
        query += ` AND LOWER(TRIM(p.brand)) IN (${brandList.map(() => "?").join(",")})`;
        values.push(...brandList);
      }
    }

    if (is_new_arrival !== undefined) {
      query += " AND p.is_new_arrival = ?";
      values.push(is_new_arrival);
    }

    if (min_price) {
      query += " AND v.price >= ?";
      values.push(min_price);
    }

    if (max_price) {
      query += " AND v.price <= ?";
      values.push(max_price);
    }

    if (search) {
      query += `
        AND (
          p.name LIKE ? OR
          p.keywords LIKE ?
        )
      `;
      values.push(
        `%${search}%`,
        `%${search}%`
      );
    }

    const [[row]] = await pool.query(query, values);
    return row.total;
  } catch (err) {
    throw new Error("Error counting products: " + err.message);
  }
};




exports.getProductCategoryIds = async (product_id) => {
  // Try product.category_id first
  const [rows1] = await pool.query(
    `SELECT category_id FROM products WHERE id = ? LIMIT 1`,
    [product_id]
  );
  if (rows1.length && rows1[0].category_id) {
    return [rows1[0].category_id];
  }

  // fallback: product_categories mapping table (product_id, category_id)
  const [rows2] = await pool.query(
    `SELECT category_id FROM product_categories WHERE product_id = ?`,
    [product_id]
  );
  return rows2.map(r => r.category_id);
};


// ✅ Get Product by ID
exports.getProductById = async (id) => {
  try {
    if (!id || isNaN(id)) throw new Error("Invalid product ID");

    // Fetch product
    const [[product]] = await pool.query(
      `SELECT p.*, c.name AS category_name 
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = ? AND p.is_active = 1`,
      [id]
    );
    if (!product) return null;

    // Fetch variants with dimensions and free shipping
    const [variants] = await pool.query(
      `SELECT 
     id, sku, hsn_code, variant_name, mrp, price, stock, 
     length, width, height, weight, 
     is_default,
      cod_enabled AS variant_cod_enabled, 
     is_free_shipping,
     ROUND(((mrp - price)/mrp)*100, 2) AS discount_percentage
   FROM product_variants 
   WHERE product_id = ?`,
      [id]
    );


    // Fetch all media including video_source
    const [media] = await pool.query(
      `SELECT id, product_id, media_type, media_url, video_source, sort_order
       FROM product_media 
       WHERE product_id = ? 
       ORDER BY sort_order ASC`,
      [id]
    );

    return { ...product, variants, media };
  } catch (err) {
    throw new Error("Error fetching product by ID: " + err.message);
  }
};


// ✅ Get All Products Full (with variants & media)
exports.getAllProductsFull = async ({ limit = 100, offset = 0, search = "" }) => {
  try {
    let query = `SELECT * FROM products WHERE 1=1`;
    const values = [];

    if (search) {
      query += ` AND (
        name LIKE ? OR 
        brand LIKE ? OR 
        keywords LIKE ? OR 
        id IN (SELECT product_id FROM product_variants WHERE sku LIKE ? OR variant_name LIKE ?)
      )`;
      const s = `%${search}%`;
      values.push(s, s, s, s, s);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    values.push(parseInt(limit), parseInt(offset));

    const [products] = await pool.query(query, values);

    if (!products.length) return [];

    const productIds = products.map(p => p.id);

    const [variants] = await pool.query(
      `SELECT 
         id, product_id, sku, hsn_code, variant_name, mrp, price, stock, length, width, height, weight, is_default, cod_enabled AS variant_cod_enabled, is_free_shipping AS variant_free_shipping,
         ROUND(((mrp - price)/mrp)*100, 2) AS discount_percentage
       FROM product_variants
       WHERE product_id IN (?)`,
      [productIds]
    );

    const [media] = await pool.query(
      `SELECT id, product_id, media_type, media_url, video_source, sort_order
       FROM product_media
       WHERE product_id IN (?)
       ORDER BY sort_order ASC`,
      [productIds]
    );

    const variantMap = {};
    for (const v of variants) {
      if (!variantMap[v.product_id]) variantMap[v.product_id] = [];
      variantMap[v.product_id].push(v);
    }

    const mediaMap = {};
    for (const m of media) {
      if (!mediaMap[m.product_id]) mediaMap[m.product_id] = [];
      mediaMap[m.product_id].push(m);
    }

    return products.map(p => ({
      ...p,
      variants: variantMap[p.id] || [],
      media: mediaMap[p.id] || []
    }));
  } catch (err) {
    throw new Error("Error fetching all products: " + err.message);
  }
};

exports.countAllProductsFull = async ({ search = "" }) => {
  try {
    let query = `SELECT COUNT(*) AS total FROM products WHERE 1=1`;
    const values = [];

    if (search) {
      query += ` AND (
        name LIKE ? OR 
        brand LIKE ? OR 
        keywords LIKE ? OR 
        id IN (SELECT product_id FROM product_variants WHERE sku LIKE ? OR variant_name LIKE ?)
      )`;
      const s = `%${search}%`;
      values.push(s, s, s, s, s);
    }

    const [[{ total }]] = await pool.query(query, values);
    return total;
  } catch (err) {
    throw new Error("Error counting products: " + err.message);
  }
};





/**
 * Build fuzzy LIKE conditions for a search term.
 * Handles:
 *  - Normal terms: "backer rod" → ['backer rod', 'backer', 'rod']
 *  - Concatenated: "backrod" → ['backrod', 'back', 'rod'] (splits at min 3-char boundaries)
 *  - Space-stripped for DB REPLACE matching
 */
const buildSearchConditions = (searchTerm) => {
  const raw = searchTerm.trim().toLowerCase();
  const noSpace = raw.replace(/[\s\-]+/g, '');

  // Split by whitespace/hyphens
  const spaceWords = raw.split(/[\s\-]+/).filter(w => w.length >= 2);

  // For concatenated single words (no spaces), try to generate sub-fragments
  // by splitting at regular intervals (e.g. min 3 chars from start and remaining)
  const concatFragments = [];
  if (spaceWords.length === 1 && noSpace.length >= 4) {
    // Try splitting at positions 3, 4, 5 etc
    for (let i = 3; i <= noSpace.length - 2; i++) {
      const prefix = noSpace.slice(0, i);
      const suffix = noSpace.slice(i);
      if (prefix.length >= 3) concatFragments.push(prefix);
      if (suffix.length >= 3) concatFragments.push(suffix);
    }
  }

  const candidates = [raw, noSpace, ...spaceWords, ...concatFragments];
  // Deduplicate and remove very short fragments
  const unique = [...new Set(candidates.filter(w => w && w.length >= 2))];
  return unique.map(w => `%${w}%`);
};

exports.searchProducts = async ({ searchTerm, limit = 20, offset = 0 }) => {
  try {
    const terms = buildSearchConditions(searchTerm);
    const isNumeric = !isNaN(parseFloat(searchTerm)) && isFinite(searchTerm);
    const priceMatch = isNumeric ? parseFloat(searchTerm) : null;

    // Build a dynamic OR clause for all word fragments
    const nameConditions = terms.map(() =>
      `LOWER(p.name) LIKE ?`
    ).join(' OR ');
    const brandConditions = terms.map(() =>
      `LOWER(p.brand) LIKE ?`
    ).join(' OR ');
    const keywordConditions = terms.map(() =>
      `LOWER(p.keywords) LIKE ?`
    ).join(' OR ');
    const skuConditions = terms.map(() =>
      `LOWER(v.sku) LIKE ?`
    ).join(' OR ');
    const categoryConditions = terms.map(() =>
      `LOWER(c.name) LIKE ?`
    ).join(' OR ');
    const descConditions = terms.map(() =>
      `LOWER(p.short_description) LIKE ?`
    ).join(' OR ');

    const query = `
      SELECT 
        p.id,
        p.name,
        p.brand,
        p.short_description,
        p.keywords,
        p.gst_percent,
        p.is_free_shipping AS product_free_shipping,
        p.avg_rating,
        MIN(v.price) AS price,
        MIN(v.mrp) AS mrp,
        ROUND(((MIN(v.mrp) - MIN(v.price)) / MIN(v.mrp)) * 100, 2) AS discount_percentage,
        (SELECT stock FROM product_variants WHERE product_id = p.id ORDER BY is_default DESC, price ASC LIMIT 1) AS stock,
        m.media_url,
        m.media_type,
        c.name AS category_name
      FROM products p
      INNER JOIN product_variants v ON p.id = v.product_id
      LEFT JOIN (
        SELECT product_id, media_url, media_type
        FROM product_media
        WHERE sort_order = (SELECT MIN(sort_order) FROM product_media pm2 WHERE pm2.product_id = product_media.product_id)
      ) m ON p.id = m.product_id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = 1
      AND (
          (${nameConditions})
          OR (${brandConditions})
          OR (${keywordConditions})
          OR (${skuConditions})
          OR (${categoryConditions})
          OR (${descConditions})
          OR (${terms.map(() => `REPLACE(LOWER(p.name), ' ', '') LIKE ?`).join(' OR ')})
          OR (${terms.map(() => `REPLACE(LOWER(p.keywords), ' ', '') LIKE ?`).join(' OR ')})
          ${priceMatch !== null ? 'OR (v.price = ? OR v.mrp = ?)' : ''}
      )
      GROUP BY p.id, p.name, p.brand, p.short_description, p.keywords, p.gst_percent,
               p.is_free_shipping, p.avg_rating, m.media_url, m.media_type, c.name
      ORDER BY 
          CASE 
              WHEN (${terms.map(() => `LOWER(p.name) LIKE ?`).join(' OR ')}) THEN 1
              WHEN (${terms.map(() => `LOWER(p.brand) LIKE ?`).join(' OR ')}) THEN 2
              WHEN (${terms.map(() => `LOWER(c.name) LIKE ?`).join(' OR ')}) THEN 3
              ELSE 4
          END,
          p.avg_rating DESC,
          p.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const allTermValues = terms;
    const values = [
      ...allTermValues, // name
      ...allTermValues, // brand
      ...allTermValues, // keywords
      ...allTermValues, // sku
      ...allTermValues, // category
      ...allTermValues, // short_description
      ...allTermValues, // REPLACE(name, ' ', '')
      ...allTermValues, // REPLACE(keywords, ' ', '')
      ...(priceMatch !== null ? [priceMatch, priceMatch] : []),
      ...allTermValues, // ORDER name
      ...allTermValues, // ORDER brand
      ...allTermValues, // ORDER category
      parseInt(limit),
      parseInt(offset)
    ];

    const [rows] = await pool.query(query, values);
    return rows;
  } catch (err) {
    throw new Error("Error executing product search: " + err.message);
  }
};


exports.countSearchProducts = async (searchTerm) => {
  try {
    const terms = buildSearchConditions(searchTerm);
    const isNumeric = !isNaN(parseFloat(searchTerm)) && isFinite(searchTerm);
    const priceMatch = isNumeric ? parseFloat(searchTerm) : null;

    const nameC = terms.map(() => `LOWER(p.name) LIKE ?`).join(' OR ');
    const brandC = terms.map(() => `LOWER(p.brand) LIKE ?`).join(' OR ');
    const keyC = terms.map(() => `LOWER(p.keywords) LIKE ?`).join(' OR ');
    const skuC = terms.map(() => `LOWER(v.sku) LIKE ?`).join(' OR ');
    const catC = terms.map(() => `LOWER(c.name) LIKE ?`).join(' OR ');
    const descC = terms.map(() => `LOWER(p.short_description) LIKE ?`).join(' OR ');

    const nameRepC = terms.map(() => `REPLACE(LOWER(p.name), ' ', '') LIKE ?`).join(' OR ');
    const keyRepC = terms.map(() => `REPLACE(LOWER(p.keywords), ' ', '') LIKE ?`).join(' OR ');

    const query = `
      SELECT COUNT(DISTINCT p.id) AS total
      FROM products p
      INNER JOIN product_variants v ON p.id = v.product_id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = 1
      AND (
          (${nameC})
          OR (${brandC})
          OR (${keyC})
          OR (${skuC})
          OR (${catC})
          OR (${descC})
          OR (${nameRepC})
          OR (${keyRepC})
          ${priceMatch !== null ? 'OR (v.price = ? OR v.mrp = ?)' : ''}
      )
    `;

    const values = [
      ...terms, ...terms, ...terms, ...terms, ...terms, ...terms,
      ...terms, ...terms, // REPLACE conditions
      ...(priceMatch !== null ? [priceMatch, priceMatch] : [])
    ];

    const [[result]] = await pool.query(query, values);
    return result.total;
  } catch (err) {
    throw new Error("Error counting search products: " + err.message);
  }
};


/**
 * Get search suggestions (lightweight autocomplete)
 */
exports.getSearchSuggestions = async (searchTerm, limit = 8) => {
  try {
    const terms = buildSearchConditions(searchTerm);

    const nameC = terms.map(() => `LOWER(p.name) LIKE ?`).join(' OR ');
    const brandC = terms.map(() => `LOWER(p.brand) LIKE ?`).join(' OR ');
    const catC = terms.map(() => `LOWER(c.name) LIKE ?`).join(' OR ');

    const nameRepC = terms.map(() => `REPLACE(LOWER(p.name), ' ', '') LIKE ?`).join(' OR ');

    const query = `
      SELECT DISTINCT
        p.id,
        p.name,
        p.brand,
        MIN(v.price) AS price,
        m.media_url,
        c.name AS category_name
      FROM products p
      INNER JOIN product_variants v ON p.id = v.product_id
      LEFT JOIN product_media m ON p.id = m.product_id AND m.sort_order = 1
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = 1
      AND (
          (${nameC})
          OR (${brandC})
          OR (${catC})
          OR (${nameRepC})
      )
      GROUP BY p.id, p.name, p.brand, m.media_url, c.name
      ORDER BY
          CASE WHEN (${terms.map(() => `LOWER(p.name) LIKE ?`).join(' OR ')}) THEN 1 ELSE 2 END,
          p.avg_rating DESC
      LIMIT ?
    `;

    const values = [
      ...terms, ...terms, ...terms, ...terms, // name, brand, cat, nameRep
      ...terms, // ORDER name
      parseInt(limit)
    ];

    const [rows] = await pool.query(query, values);
    return rows;
  } catch (err) {
    throw new Error("Error fetching search suggestions: " + err.message);
  }
};







// const pool = require("../config/db");

// const getDB = (conn) => conn || pool;


// // ================== VALIDATION HELPERS ==================


// exports.getMediaById = async (media_id) => {
//   const [[row]] = await pool.query(`SELECT * FROM product_media WHERE id = ? LIMIT 1`, [media_id]);
//   return row;
// };

// exports.getMaxSortOrderByProductId = async (product_id) => {
//   const [[row]] = await pool.query(`SELECT COALESCE(MAX(sort_order),0) AS maxSort FROM product_media WHERE product_id = ?`, [product_id]);
//   return row.maxSort;
// };

// exports.updateMediaUrl = async (media_id, url) => {
//   await pool.query(`UPDATE product_media SET media_url = ? WHERE id = ?`, [url, media_id]);
//   return true;
// };


// const validateProductData = ({ name, brand, description, short_description, is_free_shipping, cod_enabled, gst_percent }) => {
//   if (!name || typeof name !== "string" || name.trim().length < 3) {
//     throw new Error("Product name is required and must be at least 3 characters");
//   }
//   if (!brand || typeof brand !== "string" || brand.trim().length < 2) {
//     throw new Error("Brand is required and must be at least 2 characters");
//   }
//   // if (description && description.length > 2000) {
//   //   throw new Error("Description is too long (max 2000 chars)");
//   // }
//   if (short_description && short_description.length > 2000) {
//     throw new Error("Short description is too long (max 2000 chars)");
//   }
//   if (is_free_shipping != null && ![0, 1, true, false].includes(is_free_shipping)) {
//     throw new Error("is_free_shipping must be a boolean (true/false or 0/1)");
//   }

//   if (cod_enabled != null && ![0, 1, true, false].includes(cod_enabled)) {
//     throw new Error("cod_enabled must be a boolean (true/false or 0/1)");
//   }

//   if (gst_percent != null && (isNaN(gst_percent) || gst_percent < 0)) {
//     throw new Error("gst_percent must be a non-negative number");
//   }

// };


// const validateVariantData = ({ sku, mrp, price, stock, length, width, height, weight, is_free_shipping, }) => {
//   if (!sku || typeof sku !== "string" || sku.trim().length < 3) {
//     throw new Error("SKU is required and must be at least 3 characters");
//   }
//   if (!mrp || isNaN(mrp) || mrp <= 0) {
//     throw new Error("MRP must be a positive number");
//   }
//   if (!price || isNaN(price) || price <= 0) {
//     throw new Error("Price must be a positive number");
//   }
//   if (price > mrp) {
//     throw new Error("Price cannot be greater than MRP");
//   }
//   if (stock != null && (isNaN(stock) || stock < 0)) {
//     throw new Error("Stock must be a non-negative number");
//   }

//   [length, width, height, weight].forEach((val) => {
//     if (val != null && (isNaN(val) || val < 0)) {
//       throw new Error("Length, width, height, and weight must be non-negative numbers");
//     }
//   });

//   if (is_free_shipping != null && ![0, 1, true, false].includes(is_free_shipping)) {
//     throw new Error("is_free_shipping must be a boolean (true/false or 0/1)");
//   }

// };

// exports.getVariantById = async (variantId) => {
//   try {
//     if (!variantId || isNaN(variantId)) throw new Error("Invalid variant ID");

//     // Fetch variant + product details
//     const [rows] = await pool.query(
//       `
//       SELECT
//         v.id,
//         v.product_id,
//         v.sku,
//         v.hsn_code,
//         v.variant_name,
//         v.mrp,
//         v.price,
//         v.stock,
//         v.length,
//         v.width,
//         v.height,
//         v.weight,
//         v.is_default,
//         v.cod_enabled AS variant_cod_enabled,
//         v.is_free_shipping AS variant_free_shipping,
//         ROUND(((v.mrp - v.price)/v.mrp)*100, 2) AS discount_percentage,
//         p.name AS product_name,
//         p.brand AS product_brand,
//         p.is_free_shipping AS product_free_shipping,
//         p.is_on_sale,
//         p.is_new_arrival,
//         p.is_featured,
//         p.category_id
//       FROM product_variants v
//       INNER JOIN products p ON v.product_id = p.id
//       WHERE v.id = ?
//       `,
//       [variantId]
//     );

//     if (!rows.length) return null;
//     const variant = rows[0];

//     // Fetch associated media (images/videos)

//     return {
//       ...variant
//     };
//   } catch (err) {
//     throw new Error("Error fetching variant by ID: " + err.message);
//   }
// };

// exports.getProductsNameAndId = async () => {
//   try {
//     const [rows] = await pool.query(`SELECT id, name FROM products`);
//     return rows;
//   } catch (err) {
//     throw new Error("Error fetching products: " + err.message);
//   }
// };


// exports.updateProductAvgRating = async (product_id) => {
//   const conn = await pool.getConnection();
//   try {
//     // Calculate average rating
//     const [rows] = await conn.query(
//       `SELECT AVG(rating) AS avg_rating
//        FROM reviews
//        WHERE product_id = ? AND status != 'REJECTED'`,
//       [product_id]
//     );

//     // Safely convert to number (0 if null)
//     const avg = Number(rows[0]?.avg_rating) || 0;

//     // Update product table
//     await conn.query(
//       `UPDATE products SET avg_rating = ? WHERE id = ?`,
//       [avg.toFixed(2), product_id]
//     );

//   } finally {
//     conn.release();
//   }
// };


// exports.updateVariantStockBulk = async (stockList) => {
//   if (!Array.isArray(stockList) || stockList.length === 0) {
//     throw new Error("Invalid stock list");
//   }

//   // Validate each entry
//   for (const item of stockList) {
//     if (!item.id || isNaN(item.id)) {
//       throw new Error(`Invalid variant id: ${item.id}`);
//     }

//     if (item.stock == null || isNaN(item.stock)) {
//       throw new Error(`Invalid stock value for variant ${item.id}`);
//     }

//     if (item.stock < 0) {
//       throw new Error(`Stock cannot be negative for variant ${item.id}`);
//     }
//   }

//   // Remove duplicates by ID
//   const uniqueIds = [...new Set(stockList.map(v => Number(v.id)))];

//   const conn = await pool.getConnection();

//   try {
//     await conn.beginTransaction();

//     // Verify all variant IDs exist
//     const [existing] = await conn.query(
//       `SELECT id FROM product_variants WHERE id IN (${uniqueIds.join(",")})`
//     );

//     if (existing.length !== uniqueIds.length) {
//       throw new Error("Some variant IDs do not exist");
//     }

//     // Build CASE WHEN
//     const cases = stockList
//       .map(v => `WHEN ${v.id} THEN ${v.stock}`)
//       .join(" ");

//     const sql = `
//       UPDATE product_variants
//       SET stock = CASE id
//         ${cases}
//       END
//       WHERE id IN (${uniqueIds.join(",")});
//     `;

//     await conn.query(sql);
//     await conn.commit();

//     return true;
//   } catch (err) {
//     await conn.rollback();
//     throw new Error("Bulk stock update failed: " + err.message);
//   } finally {
//     conn.release();
//   }
// };



// const validateMediaData = ({ media_type, media_url }) => {
//   const allowedTypes = ["image", "video"];
//   if (!allowedTypes.includes(media_type)) {
//     throw new Error("Invalid media type (allowed: image, video)");
//   }
//   if (!media_url || typeof media_url !== "string") {
//     throw new Error("Media URL is required");
//   }
// };

// // ================== ADMIN QUERIES ==================

// // ✅ Create Product
// exports.createProduct = async (data, conn = null) => {
//   try {
//     const db = getDB(conn);

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
//       cod_enabled
//     } = data;

//     validateProductData({
//       name,
//       description,
//       short_description,
//       brand,
//       is_free_shipping,
//       cod_enabled,
//       gst_percent
//     });

//     const codValue = cod_enabled == null ? 1 : Number(cod_enabled) ? 1 : 0;

//     const [result] = await db.query(
//       `INSERT INTO products
//        (name, description, short_description, keywords, brand, category_id,
//         is_new_arrival, is_on_sale, is_featured, is_free_shipping, cod_enabled, gst_percent)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         name,
//         description || null,
//         short_description || null,
//         keywords || null,
//         brand,
//         category_id || null,
//         Number(is_new_arrival) ? 1 : 0,
//         Number(is_on_sale) ? 1 : 0,
//         Number(is_featured) ? 1 : 0,
//         Number(is_free_shipping) ? 1 : 0,
//         codValue,
//         gst_percent || 0
//       ]
//     );

//     return result.insertId;
//   } catch (err) {
//     throw new Error("Error creating product: " + err.message);
//   }
// };


// exports.createVariant = async (data, conn = null) => {
//   try {
//     const db = getDB(conn);

//     const {
//       product_id,
//       sku,
//       hsn_code,
//       variant_name,
//       mrp,
//       price,
//       stock,
//       is_default,
//       length,
//       width,
//       height,
//       weight,
//       is_free_shipping,
//       cod_enabled
//     } = data;

//     validateVariantData({
//       sku,
//       mrp,
//       price,
//       stock,
//       length,
//       width,
//       height,
//       weight,
//       is_free_shipping
//     });

//     const [[product]] = await db.query(
//       `SELECT id FROM products WHERE id = ?`,
//       [product_id]
//     );
//     if (!product) throw new Error("Product not found");

//     const [[existing]] = await db.query(
//       `SELECT id FROM product_variants WHERE sku = ?`,
//       [sku]
//     );
//     if (existing) throw new Error("SKU already exists");

//     const [result] = await db.query(
//       `INSERT INTO product_variants
//        (product_id, sku, hsn_code, variant_name, mrp, price, stock, is_default,
//         length, width, height, weight, is_free_shipping, cod_enabled)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         product_id,
//         sku,
//         hsn_code || null,
//         variant_name || null,
//         mrp,
//         price,
//         stock || 0,
//         is_default ? 1 : 0,
//         length || null,
//         width || null,
//         height || null,
//         weight || null,
//         Number(is_free_shipping) ? 1 : 0,
//         cod_enabled == null ? 0 : Number(cod_enabled) ? 1 : 0
//       ]
//     );

//     return result.insertId;
//   } catch (err) {
//     throw new Error("Error creating variant: " + err.message);
//   }
// };



// // ================== EDITOR IMAGE ==================
// exports.saveEditorImage = async (productId, filename) => {
//   return `/uploads/editor-images/product-${productId}/${filename}`;
// };





// // ✅ Update Media
// exports.updateMedia = async (id, { media_url, video_source }) => {
//   try {
//     const [[media]] = await pool.query(`SELECT * FROM product_media WHERE id = ?`, [id]);
//     if (!media) return null;

//     const fields = [];
//     const values = [];

//     if (media_url) {
//       fields.push(`media_url=?`);
//       values.push(media_url);
//     }

//     if (video_source !== undefined) {
//       fields.push(`video_source=?`);
//       values.push(video_source);
//     }

//     if (!fields.length) return media; // nothing to update

//     values.push(id);

//     await pool.query(`UPDATE product_media SET ${fields.join(", ")} WHERE id=?`, values);

//     return true;
//   } catch (err) {
//     throw new Error("Error updating media: " + err.message);
//   }
// };


// // ✅ Add Media
// exports.addMedia = async ({ product_id, media_type, media_url, sort_order, video_source }) => {
//   try {
//     // Validate media_type and URL
//     validateMediaData({ media_type, media_url });

//     const [[product]] = await pool.query(`SELECT id FROM products WHERE id = ?`, [product_id]);
//     if (!product) throw new Error("Product not found");

//     // Only videos have video_source
//     const videoSrc = media_type === "video" && video_source ? video_source : null;

//     const [result] = await pool.query(
//       `INSERT INTO product_media (product_id, media_type, media_url, video_source, sort_order)
//        VALUES (?, ?, ?, ?, ?)`,
//       [product_id, media_type, media_url, videoSrc, sort_order || 1]
//     );

//     return result.insertId;
//   } catch (err) {
//     throw new Error("Error adding media: " + err.message);
//   }
// };


// // ✅ Delete Media
// exports.deleteMedia = async (id) => {
//   try {
//     const [[media]] = await pool.query(`SELECT * FROM product_media WHERE id = ?`, [id]);
//     if (!media) return null;

//     await pool.query(`DELETE FROM product_media WHERE id = ?`, [id]);

//     // media object now includes video_source for cleanup or logging
//     return media;
//   } catch (err) {
//     throw new Error("Error deleting media: " + err.message);
//   }
// };


// // ✅ Delete ALL Media (used for replace on update)
// exports.deleteAllMediaByProductId = async (product_id) => {
//   try {
//     // Deletes all media (images and videos, including video_source) for the product
//     await pool.query(`DELETE FROM product_media WHERE product_id = ?`, [product_id]);
//     return true;
//   } catch (err) {
//     throw new Error("Error deleting all media: " + err.message);
//   }
// };

// exports.getProductMediaByProductId = async (product_id) => {
//   try {
//     const [result] = await pool.query(`SELECT * FROM product_media WHERE product_id = ? ORDER BY sort_order ASC`, [product_id]);
//     return result;
//   } catch (err) {
//     throw new Error("Error fetching product media: " + err.message);
//   }
// }


// // ✅ Update Product
// // exports.updateProduct = async (id, fields) => {
// //   try {
// //     if (!id) throw new Error("Product ID required");
// //     if (!fields || Object.keys(fields).length === 0) throw new Error("No fields to update");
// //     // remove gst_type if mistakenly passed
// //     delete fields.gst_type;

// //      // ✅ Normalize cod_enabled
// //     if (fields.cod_enabled != null) {
// //       fields.cod_enabled = Number(fields.cod_enabled) ? 1 : 0;
// //     }

// //     if (
// //       fields.name ||
// //       fields.brand ||
// //       fields.description ||
// //       fields.short_description ||
// //       fields.keywords ||
// //       fields.is_free_shipping != null ||
// //       fields.cod_enabled != null
// //     ) {
// //       validateProductData(fields);
// //     }

// //     const updates = Object.keys(fields).map(key => `${key} = ?`).join(", ");
// //     const values = [...Object.values(fields), id];

// //     const conn = await pool.getConnection();
// // try {
// //   await conn.beginTransaction();

// //   const [result] = await conn.query(
// //     `UPDATE products SET ${updates}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
// //     values
// //   );

// //   // 🔥 CRITICAL ADDITION
// //   // If product COD is OFF → force all variants COD OFF
// //   if (fields.cod_enabled === 0) {
// //     await conn.query(
// //       `UPDATE product_variants SET cod_enabled = 0 WHERE product_id = ?`,
// //       [id]
// //     );
// //   }

// //   await conn.commit();
// //   return result.affectedRows > 0;
// // } catch (e) {
// //   await conn.rollback();
// //   throw e;
// // } finally {
// //   conn.release();
// // }

// //   } catch (err) {
// //     throw new Error("Error updating product: " + err.message);
// //   }
// // };

// exports.updateProduct = async (id, fields, conn = null) => {
//   if (!id) throw new Error("Product ID required");
//   if (!fields || Object.keys(fields).length === 0)
//     throw new Error("No fields to update");

//   const db = getDB(conn);
//   delete fields.gst_type;

//   if (fields.cod_enabled != null)
//     fields.cod_enabled = Number(fields.cod_enabled) ? 1 : 0;

//   validateProductData(fields);

//   const updates = Object.keys(fields).map(k => `${k} = ?`).join(", ");
//   const values = [...Object.values(fields), id];

//   const [result] = await db.query(
//     `UPDATE products
//      SET ${updates}, updated_at = CURRENT_TIMESTAMP
//      WHERE id = ?`,
//     values
//   );

//   // 🔥 Enforce COD rule
//   if (fields.cod_enabled === 0) {
//     await db.query(
//       `UPDATE product_variants SET cod_enabled = 0 WHERE product_id = ?`,
//       [id]
//     );
//   }

//   return result.affectedRows > 0;
// };




// exports.updateVariant = async (id, fields, conn = null) => {
//   if (!id) throw new Error("Variant ID required");
//   if (!fields || Object.keys(fields).length === 0)
//     throw new Error("No fields to update");

//   const db = getDB(conn);

//   if (fields.cod_enabled != null) {
//     fields.cod_enabled = Number(fields.cod_enabled) ? 1 : 0;

//     const [[row]] = await db.query(
//       `SELECT p.cod_enabled
//        FROM product_variants v
//        JOIN products p ON p.id = v.product_id
//        WHERE v.id = ?`,
//       [id]
//     );

//     if (!row) throw new Error("Variant not found");

//     if (row.cod_enabled === 0 && fields.cod_enabled === 1)
//       throw new Error("Cannot enable COD for variant when product COD is disabled");
//   }

//   validateVariantData(fields);

//   const updates = Object.keys(fields).map(k => `${k} = ?`).join(", ");
//   const values = [...Object.values(fields), id];

//   const [result] = await db.query(
//     `UPDATE product_variants
//      SET ${updates}, updated_at = CURRENT_TIMESTAMP
//      WHERE id = ?`,
//     values
//   );

//   return result.affectedRows > 0;
// };





// // ✅ Delete Product
// exports.deleteProduct = async (id) => {
//   try {
//     if (!id) throw new Error("Product ID required");

//     // Delete all child records first: media (images & videos including video_source) and variants (including dimensions & free shipping)
//     await pool.query(`DELETE FROM product_media WHERE product_id = ?`, [id]);
//     await pool.query(`DELETE FROM product_variants WHERE product_id = ?`, [id]);

//     const [result] = await pool.query(`DELETE FROM products WHERE id = ?`, [id]);
//     return result.affectedRows > 0;
//   } catch (err) {
//     throw new Error("Error deleting product: " + err.message);
//   }
// };


// // ================== USER QUERIES ==================

// // ✅ Get Filtered Products
// // exports.getFilteredProducts = async ({ category, brand, min_price, max_price, sort, search, limit, offset }) => {
// //   try {
// //     let query = `SELECT
// //   p.id, p.name, p.brand, p.keywords, p.description, p.short_description,
// //   p.is_free_shipping, p.gst_percent, p.is_on_sale, p.is_featured,
// //   v.price, v.mrp,
// //   ROUND(((v.mrp - v.price) / v.mrp) * 100, 2) AS discount_percentage,
// //   m.media_url, m.video_source
// // FROM products p
// // LEFT JOIN (
// //   SELECT product_id, MIN(price) AS price, MIN(mrp) AS mrp
// //   FROM product_variants
// //   GROUP BY product_id
// // ) v ON p.id = v.product_id
// // LEFT JOIN product_media m ON p.id = m.product_id AND m.sort_order = 1
// // WHERE p.is_active = 1`;
// //     const values = [];

// //     if (category) {
// //       query += " AND p.category_id = ?";
// //       values.push(category);
// //     }
// //     if (brand) {
// //       query += " AND p.brand = ?";
// //       values.push(brand);
// //     }
// //     if (min_price) {
// //       query += " AND v.price >= ?";
// //       values.push(min_price);
// //     }
// //     if (max_price) {
// //       query += " AND v.price <= ?";
// //       values.push(max_price);
// //     }
// //     if (search) {
// //       query += " AND (p.name LIKE ? OR p.description LIKE ? OR p.short_description LIKE ? OR p.keywords LIKE ?)";
// //       values.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
// //     }

// //     switch (sort) {
// //       case "price_asc":
// //         query += " ORDER BY v.price ASC"; break;
// //       case "price_desc":
// //         query += " ORDER BY v.price DESC"; break;
// //       case "discount_desc":
// //         query += " ORDER BY discount_percentage DESC"; break;
// //       case "newest":
// //       default:
// //         query += " ORDER BY p.created_at DESC";
// //     }

// //     if (limit) {
// //       query += " LIMIT ?";
// //       values.push(parseInt(limit));
// //       if (offset) {
// //         query += " OFFSET ?";
// //         values.push(parseInt(offset));
// //       }
// //     }

// //     const [rows] = await pool.query(query, values);
// //     return rows;
// //   } catch (err) {
// //     throw new Error("Error fetching products: " + err.message);
// //   }
// // };


// exports.getFilteredProducts = async ({
//   category,
//   brand,
//   min_price,
//   max_price,
//   sort,
//   search,
//   is_new_arrival,
//   limit,
//   offset
// }) => {
//   try {
//     let query = `
//       SELECT
//         p.id,
//         p.name,
//         p.brand,
//         p.keywords,
//         p.description,
//         p.short_description,
//         p.is_free_shipping,
//         p.gst_percent,
//         p.is_on_sale,
//         p.is_featured,
//         p.is_new_arrival,
//         v.price,
//         v.mrp,
//         ROUND(((v.mrp - v.price) / v.mrp) * 100, 2) AS discount_percentage,
//         m.media_url,
//         m.video_source
//       FROM products p
//       LEFT JOIN (
//         SELECT product_id, MIN(price) AS price, MIN(mrp) AS mrp
//         FROM product_variants
//         GROUP BY product_id
//       ) v ON p.id = v.product_id
//       LEFT JOIN product_media m
//         ON p.id = m.product_id AND m.sort_order = 1
//       WHERE p.is_active = 1
//     `;

//     const values = [];

//     if (category) {
//       query += " AND p.category_id = ?";
//       values.push(category);
//     }

//     if (brand) {
//       query += " AND p.brand = ?";
//       values.push(brand);
//     }

//     if (is_new_arrival !== undefined) {
//       query += " AND p.is_new_arrival = ?";
//       values.push(is_new_arrival);
//     }

//     if (min_price) {
//       query += " AND v.price >= ?";
//       values.push(min_price);
//     }

//     if (max_price) {
//       query += " AND v.price <= ?";
//       values.push(max_price);
//     }

//     if (search) {
//       query += `
//         AND (
//           p.name LIKE ? OR
//           p.keywords LIKE ? OR
//           p.short_description LIKE ?
//         )
//       `;
//       values.push(
//         `%${search}%`,
//         `%${search}%`,
//         `%${search}%`
//       );
//     }

//     switch (sort) {
//       case "price_asc":
//         query += " ORDER BY v.price ASC";
//         break;
//       case "price_desc":
//         query += " ORDER BY v.price DESC";
//         break;
//       case "discount_desc":
//         query += " ORDER BY discount_percentage DESC";
//         break;
//       default:
//         query += " ORDER BY p.created_at DESC";
//     }

//     if (limit !== undefined && offset !== undefined) {
//       query += " LIMIT ? OFFSET ?";
//       values.push(Number(limit), Number(offset));
//     }

//     const [rows] = await pool.query(query, values);
//     return rows;
//   } catch (err) {
//     throw new Error("Error fetching filtered products: " + err.message);
//   }
// };

// /**
//  * COUNT FILTERED PRODUCTS (FOR PAGINATION)
//  */
// exports.countFilteredProducts = async ({
//   category,
//   brand,
//   min_price,
//   max_price,
//   search,
//   is_new_arrival
// }) => {
//   try {
//     let query = `
//       SELECT COUNT(DISTINCT p.id) AS total
//       FROM products p
//       LEFT JOIN product_variants v ON p.id = v.product_id
//       WHERE p.is_active = 1
//     `;

//     const values = [];

//     if (category) {
//       query += " AND p.category_id = ?";
//       values.push(category);
//     }

//     if (brand) {
//       query += " AND p.brand = ?";
//       values.push(brand);
//     }

//     if (is_new_arrival !== undefined) {
//       query += " AND p.is_new_arrival = ?";
//       values.push(is_new_arrival);
//     }

//     if (min_price) {
//       query += " AND v.price >= ?";
//       values.push(min_price);
//     }

//     if (max_price) {
//       query += " AND v.price <= ?";
//       values.push(max_price);
//     }

//     if (search) {
//       query += `
//         AND (
//           p.name LIKE ? OR
//           p.keywords LIKE ?
//         )
//       `;
//       values.push(
//         `%${search}%`,
//         `%${search}%`
//       );
//     }

//     const [[row]] = await pool.query(query, values);
//     return row.total;
//   } catch (err) {
//     throw new Error("Error counting products: " + err.message);
//   }
// };




// exports.getProductCategoryIds = async (product_id) => {
//   // Try product.category_id first
//   const [rows1] = await pool.query(
//     `SELECT category_id FROM products WHERE id = ? LIMIT 1`,
//     [product_id]
//   );
//   if (rows1.length && rows1[0].category_id) {
//     return [rows1[0].category_id];
//   }

//   // fallback: product_categories mapping table (product_id, category_id)
//   const [rows2] = await pool.query(
//     `SELECT category_id FROM product_categories WHERE product_id = ?`,
//     [product_id]
//   );
//   return rows2.map(r => r.category_id);
// };


// // ✅ Get Product by ID
// exports.getProductById = async (id) => {
//   try {
//     if (!id || isNaN(id)) throw new Error("Invalid product ID");

//     // Fetch product
//     const [[product]] = await pool.query(
//       `SELECT * FROM products WHERE id = ? AND is_active = 1`,
//       [id]
//     );
//     if (!product) return null;

//     // Fetch variants with dimensions and free shipping
//    const [variants] = await pool.query(
//   `SELECT
//      id, sku, hsn_code, variant_name, mrp, price, stock,
//      length, width, height, weight,
//      is_default,
//      cod_enabled AS variant_cod_enabled,
//      is_free_shipping AS variant_free_shipping,
//      ROUND(((mrp - price)/mrp)*100, 2) AS discount_percentage
//    FROM product_variants
//    WHERE product_id = ?`,
//   [id]
// );


//     // Fetch all media including video_source
//     const [media] = await pool.query(
//       `SELECT id, product_id, media_type, media_url, video_source, sort_order
//        FROM product_media
//        WHERE product_id = ?
//        ORDER BY sort_order ASC`,
//       [id]
//     );

//     return { ...product, variants, media };
//   } catch (err) {
//     throw new Error("Error fetching product by ID: " + err.message);
//   }
// };


// // ✅ Get All Products Full (with variants & media)
// exports.getAllProductsFull = async ({ limit = 100, offset = 0 }) => {
//   try {
//     const [products] = await pool.query(
//       `SELECT * FROM products
//        WHERE is_active = 1
//        ORDER BY created_at DESC
//        LIMIT ? OFFSET ?`,
//       [parseInt(limit), parseInt(offset)]
//     );

//     if (!products.length) return [];

//     const productIds = products.map(p => p.id);

//     const [variants] = await pool.query(
//       `SELECT
//          id, product_id, sku, hsn_code, variant_name, mrp, price, stock, length, width, height, weight, is_default, cod_enabled AS variant_cod_enabled, is_free_shipping AS variant_free_shipping,
//          ROUND(((mrp - price)/mrp)*100, 2) AS discount_percentage
//        FROM product_variants
//        WHERE product_id IN (?)`,
//       [productIds]
//     );

//     const [media] = await pool.query(
//       `SELECT id, product_id, media_type, media_url, video_source, sort_order
//        FROM product_media
//        WHERE product_id IN (?)
//        ORDER BY sort_order ASC`,
//       [productIds]
//     );

//     const variantMap = {};
//     for (const v of variants) {
//       if (!variantMap[v.product_id]) variantMap[v.product_id] = [];
//       variantMap[v.product_id].push(v);
//     }

//     const mediaMap = {};
//     for (const m of media) {
//       if (!mediaMap[m.product_id]) mediaMap[m.product_id] = [];
//       mediaMap[m.product_id].push(m);
//     }

//     return products.map(p => ({
//       ...p,
//       variants: variantMap[p.id] || [],
//       media: mediaMap[p.id] || []
//     }));
//   } catch (err) {
//     throw new Error("Error fetching all products: " + err.message);
//   }
// };



// exports.searchProducts = async ({ searchTerm, limit = 10, offset = 0 }) => {
//   try {
//     const term = `%${searchTerm.toLowerCase()}%`;
//     const isNumeric = !isNaN(parseFloat(searchTerm)) && isFinite(searchTerm);
//     const priceMatch = isNumeric ? parseFloat(searchTerm) : null;

//     const query = `
//       SELECT
//         p.id, p.name, p.brand, p.short_description, p.keywords,
//         p.gst_percent, p.cod_enabled AS product_cod_enabled, p.is_free_shipping AS product_free_shipping,
//         v.id AS variant_id, v.sku, v.hsn_code, v.variant_name, v.mrp, v.price, v.stock, v.is_default,
//         ROUND(((v.mrp - v.price)/v.mrp)*100, 2) AS discount_percentage,
//         m.media_url, m.media_type,
//         c.name AS category_name
//       FROM products p
//       JOIN product_variants v ON p.id = v.product_id
//       LEFT JOIN product_media m ON p.id = m.product_id AND m.sort_order = 1
//       LEFT JOIN categories c ON p.category_id = c.id
//       WHERE p.is_active = 1
//       AND (
//           LOWER(p.name) LIKE ?
//           OR LOWER(p.description) LIKE ?
//           OR LOWER(p.brand) LIKE ?
//           OR LOWER(REPLACE(p.keywords, ',', ' ')) LIKE ? -- ✅ supports comma-separated keywords
//           OR LOWER(v.sku) LIKE ?
//           OR LOWER(c.name) LIKE ?
//           OR (v.price = ? OR v.mrp = ?)
//       )
//       ORDER BY
//           CASE
//               WHEN LOWER(p.name) LIKE ? THEN 1
//               WHEN LOWER(p.brand) LIKE ? THEN 2
//               WHEN LOWER(c.name) LIKE ? THEN 3
//               WHEN LOWER(REPLACE(p.keywords, ',', ' ')) LIKE ? THEN 4
//               ELSE 5
//           END,
//           p.created_at DESC
//       LIMIT ? OFFSET ?
//     `;

//     const values = [
//       term, term, term, term, term, term,
//       priceMatch, priceMatch,
//       term, term, term, term,
//       parseInt(limit), parseInt(offset)
//     ];

//     const [rows] = await pool.query(query, values);
//     return rows;
//   } catch (err) {
//     throw new Error("Error executing product search: " + err.message);
//   }
// };



// exports.countSearchProducts = async (searchTerm) => {
//   try {
//     const term = `%${searchTerm.toLowerCase()}%`;

//     // Use COUNT(DISTINCT p.id) to ensure we count each product only once,
//     // even if it matches via multiple variants or category joins.
//     const query = `
//             SELECT
//                 COUNT(DISTINCT p.id) AS total
//             FROM products p
//             JOIN product_variants v ON p.id = v.product_id
//             LEFT JOIN categories c ON p.category_id = c.id
//             WHERE p.is_active = 1
//             AND (
//                 LOWER(p.name) LIKE ?
//                 OR LOWER(p.description) LIKE ?
//                 OR LOWER(p.brand) LIKE ?
//                 OR LOWER(v.sku) LIKE ?
//                 OR LOWER(c.name) LIKE ?
//                 OR (v.price = ? OR v.mrp = ?)
//             )
//         `;

//     const isNumeric = !isNaN(parseFloat(searchTerm)) && isFinite(searchTerm);
//     const priceMatch = isNumeric ? parseFloat(searchTerm) : null;

//     const values = [
//       term, term, term, term, term,
//       priceMatch, priceMatch
//     ];

//     const [[result]] = await pool.query(query, values);
//     return result.total;

//   } catch (err) {
//     throw new Error("Error counting search products: " + err.message);
//   }
// };



