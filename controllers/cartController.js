const Cart = require("../models/cartModel");

// Add to cart
exports.addToCart = async (req, res) => {
  try {
    const { variant_id, quantity = 1 } = req.body;
    const user_id = req.user?.id; // from auth middleware

    if (!variant_id) {
      return res.status(400).json({ message: "Variant ID is required" });
    }

    const result = await Cart.addToCart({ user_id, variant_id, quantity });
    res.json({ message: "Cart Item added successfully", result });
  } catch (err) {
    res.status(500).json({ message: "Error adding to cart", error: err.message });
  }
};

// Get cart
exports.getCart = async (req, res) => {
  try {
    const user_id = req.user?.id;
    const cart = await Cart.getCartByUser(user_id);
    res.json({ cart });
  } catch (err) {
    res.status(500).json({ message: "Error fetching cart", error: err.message });
  }
};

// Update cart item quantity
exports.updateCartItem = async (req, res) => {
  try {
    const { cart_item_id, quantity } = req.body;
    const user_id = req.user?.id;

    if (!cart_item_id || quantity === undefined) {
      return res
        .status(400)
        .json({ message: "cart_item_id and quantity are required" });
    }

    const result = await Cart.updateCartItem({ cart_item_id, user_id, quantity });
    res.json({ message: "Cart item updated successfully", result });
  } catch (err) {
    res.status(500).json({ message: "Error updating cart", error: err.message });
  }
};

// Remove cart item
exports.removeCartItem = async (req, res) => {
  try {
    const { cart_item_id } = req.params;
    const user_id = req.user?.id;

    if (!cart_item_id) {
      return res.status(400).json({ message: "cart_item_id is required" });
    }

    const result = await Cart.removeCartItem({ cart_item_id, user_id });
    res.json({ message: "Cart item removed successfully", result });
  } catch (err) {
    res.status(500).json({ message: "Error removing cart item", error: err.message });
  }
};

// Clear cart (after checkout)
exports.clearCart = async (req, res) => {
  try {
    const user_id = req.user?.id;
    const result = await Cart.clearCart(user_id);
    res.json({ message: "Cart cleared successfully", result });
  } catch (err) {
    res.status(500).json({ message: "Error clearing cart", error: err.message });
  }
};
