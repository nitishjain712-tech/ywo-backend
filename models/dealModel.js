const pool = require("../config/db");

// ✅ Create Deal
// ================= CREATE DEAL =================
exports.createDeal = async (dealData) => {
  const [result] = await pool.query(
    `INSERT INTO deal_of_day
     (product_id, product_variant_id, deal_price, start_date, end_date, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      dealData.product_id,
      dealData.product_variant_id,
      dealData.deal_price,
      dealData.start_date,
      dealData.end_date,
      dealData.is_active ?? true,
    ]
  );

  return result.insertId;
};

// ✅ Get All Deals
exports.getDeals = async () => {
  const [rows] = await pool.query(
    `SELECT d.*, 
            p.name, 
            v.price AS original_price, 
            v.mrp, 
            v.sku
     FROM deal_of_day d
     JOIN products p ON d.product_id = p.id
     JOIN product_variants v ON v.product_id = p.id AND v.is_default = 1
     ORDER BY d.created_at DESC`
  );
  return rows;
};

exports.getActiveDealByVariantId = async (variantId) => {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  const [rows] = await pool.query(
    `SELECT d.*,
            p.name,
            v.price AS original_price,
            v.mrp,
            v.sku
     FROM deal_of_day d
     JOIN product_variants v ON v.id = d.product_variant_id
     JOIN products p ON p.id = d.product_id
     WHERE d.product_variant_id = ?
       AND d.is_active = TRUE
       AND d.start_date <= ?
       AND d.end_date >= ?
     LIMIT 1`,
    [variantId, now, now]
  );

  return rows[0];
};

exports.getActiveDealForVariantOrProduct = async (
  productId,
  variantId
) => {
  const variantDeal =
    variantId &&
    (await exports.getActiveDealByVariantId(variantId));

  if (variantDeal) return variantDeal;

  return await exports.getActiveDealByProductId(productId);
};



// ✅ Get Active Deals (valid now)
exports.getActiveDeals = async () => {
  const now = new Date().toISOString().slice(0,19).replace('T',' ');

  const [rows] = await pool.query(
    `SELECT d.*, 
            p.name, 
            v.price AS original_price, 
            v.mrp, 
            v.sku
     FROM deal_of_day d
     JOIN products p ON d.product_id = p.id
     JOIN product_variants v ON v.product_id = p.id AND v.is_default = 1
     WHERE d.is_active = TRUE 
       AND d.start_date <= ? 
       AND d.end_date >= ?
     ORDER BY d.created_at DESC`,
    [now, now]
  );
  return rows;
};

// ✅ Get Deal by ID
exports.getDealById = async (id) => {
  const [rows] = await pool.query(
    `SELECT d.*, 
            p.name, 
            v.price AS original_price, 
            v.mrp, 
            v.sku
     FROM deal_of_day d
     JOIN products p ON d.product_id = p.id
     JOIN product_variants v ON v.product_id = p.id AND v.is_default = 1
     WHERE d.id = ?`,
    [id]
  );
  return rows[0];
};

// ✅ Update Deal
exports.updateDeal = async (id, dealData) => {
  const [result] = await pool.query(
    `UPDATE deal_of_day
     SET product_id = ?,
         product_variant_id = ?,
         deal_price = ?,
         start_date = ?,
         end_date = ?,
         is_active = ?
     WHERE id = ?`,
    [
      dealData.product_id,
      dealData.product_variant_id,
      dealData.deal_price,
      dealData.start_date,
      dealData.end_date,
      dealData.is_active,
      id,
    ]
  );

  return result.affectedRows > 0;
};

// ================= VARIANT OWNERSHIP CHECK =================
exports.isVariantOfProduct = async (productId, variantId) => {
  const [rows] = await pool.query(
    `SELECT id
     FROM product_variants
     WHERE id = ? AND product_id = ?
     LIMIT 1`,
    [variantId, productId]
  );

  return rows.length > 0;
};


// ✅ Delete Deal
exports.deleteDeal = async (id) => {
  const [result] = await pool.query(
    `DELETE FROM deal_of_day WHERE id = ?`,
    [id]
  );
  return result.affectedRows > 0;
};


// ✅ Get Active Deal By Product ID
exports.getActiveDealByProductId = async (productId) => {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  const [rows] = await pool.query(
    `SELECT d.*,
            p.name,
            v.price AS original_price,
            v.mrp,
            v.sku
     FROM deal_of_day d
     JOIN products p ON p.id = d.product_id
     JOIN product_variants v 
          ON v.product_id = p.id AND v.is_default = 1
     WHERE d.product_id = ?
       AND d.product_variant_id IS NULL
       AND d.is_active = TRUE
       AND d.start_date <= ?
       AND d.end_date >= ?
     LIMIT 1`,
    [productId, now, now]
  );

  return rows[0];
};

