const pool = require("../config/db");

// ✅ Add or increment cart item
exports.addToCart = async ({ user_id, variant_id, quantity }) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, quantity FROM cart_items WHERE user_id = ? AND variant_id = ?`,
      [user_id, variant_id]
    );

    if (rows.length > 0) {
      // Already exists → increment
      await pool.query(
        `UPDATE cart_items 
         SET quantity = quantity + ? 
         WHERE user_id = ? AND variant_id = ?`,
        [quantity, user_id, variant_id]
      );
      return { Inserted: true };
    } else {
      // Insert new row
      const [result] = await pool.query(
        `INSERT INTO cart_items (user_id, variant_id, quantity)
         VALUES (?, ?, ?)`,
        [user_id, variant_id, quantity]
      );
      return { insertedId: result.insertId };
    }
  } catch (err) {
    throw new Error("Error adding to cart: " + err.message);
  }
};

// ✅ Get cart items with product + media
exports.getCartByUser = async (user_id) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
          ci.id AS cart_item_id,
          ci.quantity,
          pv.id AS variant_id,
          pv.sku,
          pv.variant_name,
          pv.mrp,
          pv.price,
          pv.stock,
          ROUND(((pv.mrp - pv.price)/pv.mrp)*100, 2) AS discount_percentage,
          p.id AS product_id,
          p.name AS product_name,
          p.brand,
          pm.media_url
       FROM cart_items ci
       JOIN product_variants pv ON ci.variant_id = pv.id
       JOIN products p ON pv.product_id = p.id
       LEFT JOIN product_media pm 
              ON pm.product_id = p.id 
             AND pm.sort_order = 1 -- first image as thumbnail
       WHERE ci.user_id = ?`,
      [user_id]
    );
    return rows;
  } catch (err) {
    throw new Error("Error fetching cart: " + err.message);
  }
};

// ✅ Update cart item quantity
exports.updateCartItem = async ({ cart_item_id, user_id, quantity }) => {
  try {
    if (quantity <= 0) {
      await pool.query(`DELETE FROM cart_items WHERE id = ? AND user_id = ?`, [
        cart_item_id,
        user_id,
      ]);
      return { deleted: true };
    } else {
      await pool.query(
        `UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?`,
        [quantity, cart_item_id, user_id]
      );
      return { updated: true };
    }
  } catch (err) {
    throw new Error("Error updating cart: " + err.message);
  }
};

// ✅ Remove specific item
exports.removeCartItem = async ({ cart_item_id, user_id }) => {
  try {
    await pool.query(`DELETE FROM cart_items WHERE id = ? AND user_id = ?`, [
      cart_item_id,
      user_id,
    ]);
    return { deleted: true };
  } catch (err) {
    throw new Error("Error removing cart item: " + err.message);
  }
};

// ✅ Clear cart after checkout
exports.clearCart = async (user_id) => {
  try {
    await pool.query(`DELETE FROM cart_items WHERE user_id = ?`, [user_id]);
    return { cleared: true };
  } catch (err) {
    throw new Error("Error clearing cart: " + err.message);
  }
};
