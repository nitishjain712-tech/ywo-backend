const logger = require("../utils/logger");
const Review = require("../models/reviewModel");
const { updateProductAvgRating } = require("../models/productModel");

exports.createReview = async (req, res) => {
  try {
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: "Unauthorized" });

    const { product_id, order_id, order_item_id, rating, comment = "" } = req.body;

    // Validation
    if (!product_id || !order_id || !order_item_id || !rating)
      return res.status(400).json({ error: "Missing required fields." });

    if (rating < 1 || rating > 5)
      return res.status(400).json({ error: "Rating must be between 1 and 5." });

    // Create review
    const reviewId = await Review.createUserReview({
      user_id,
      product_id,
      order_id,
      order_item_id,
      rating,
      comment,
    });

    // Update product avg rating
    await updateProductAvgRating(product_id);

    res.status(201).json({ message: "Review added successfully", review_id: reviewId });
  } catch (err) {
    if (err.message.includes("Invalid order item") || err.message.includes("Unauthorized"))
      return res.status(403).json({ error: err.message });
    if (err.message.includes("reviewed"))
      return res.status(409).json({ error: err.message });
    if (err.message.includes("delivered"))
      return res.status(400).json({ error: err.message });

    logger.error("❌ Error creating review:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
};

// ✅ Update review
exports.updateReview = async (req, res) => {
  try {
    const user_id = req.user?.id;
    const { id } = req.params;
    const { rating, comment = "" } = req.body;

    if (!user_id) return res.status(401).json({ error: "Unauthorized" });
    if (!id) return res.status(400).json({ error: "Review ID required" });
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ error: "Rating must be between 1 and 5" });

    const product_id = await Review.updateUserReview({
      user_id,
      review_id: id,
      rating,
      comment,
    });

    // Update avg rating for product
    if (product_id) await updateProductAvgRating(product_id);

    res.json({ message: "Review updated successfully" });
  } catch (err) {
    if (err.message.includes("not found"))
      return res.status(404).json({ error: err.message });

    logger.error("❌ Error updating review:", err);
    res.status(500).json({ error: "Failed to update review" });
  }
};

// ✅ Delete review (soft delete)
exports.deleteReview = async (req, res) => {
  try {
    const user_id = req.user?.id;
    const { id } = req.params;

    if (!user_id) return res.status(401).json({ error: "Unauthorized" });
    if (!id) return res.status(400).json({ error: "Review ID required" });

    const product_id = await Review.deleteUserReview(user_id, id);
    if (product_id) await updateProductAvgRating(product_id);

    res.json({ message: "Review deleted successfully" });
  } catch (err) {
    if (err.message.includes("not found"))
      return res.status(404).json({ error: err.message });

    logger.error("❌ Error deleting review:", err);
    res.status(500).json({ error: "Failed to delete review" });
  }
};

// ✅ Permanently delete review
exports.deleteReviewPermanentlyById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "Review ID required" });

    const product_id = await Review.deleteReviewPermanentlyById(id);
    if (product_id) await updateProductAvgRating(product_id);

    res.json({ message: "Review permanently deleted successfully" });
  } catch (err) {
    if (err.message.includes("not found"))
      return res.status(404).json({ error: err.message });

    logger.error("❌ Error deleting review:", err);
    res.status(500).json({ error: "Failed to delete review" });
  }
};

// ✅ Get all reviews for a product
exports.getProductReviews = async (req, res) => {
  try {
    const { product_id } = req.params;
    if (!product_id) return res.status(400).json({ error: "product_id required" });

    const reviews = await Review.getProductReviews(product_id);
    res.json({ reviews });
  } catch (err) {
    logger.error("❌ Error fetching reviews:", err);
    res.status(500).json({ error: "Failed to fetch reviews." });
  }
};


exports.restoreReview = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "Review ID required" });

    await Review.restoreReview(id);
    res.json({ message: "Review restored successfully" });
  } catch (err) {
    if (err.message.includes("not found"))
      return res.status(404).json({ error: err.message });

    logger.error("❌ Error restoring review:", err);
    res.status(500).json({ error: "Failed to restore review" });
  }
};


// ✅ Get all reviews by user
exports.getUserReviews = async (req, res) => {
  try {
    const { user_id } = req.params;
    if (!user_id) return res.status(400).json({ error: "User ID required" });

    const reviews = await Review.getUserReviews(user_id);
    res.json({ reviews });
  } catch (err) {
    logger.error("❌ Error fetching reviews:", err);
    res.status(500).json({ error: "Failed to fetch reviews." });
  }
};


exports.getAllVerifiedReviews = async (req, res) => {
  try {
    const reviews = await Review.getAllApprovedAndVerifiedReviews();
    res.json({ reviews });
  } catch (err) {
    logger.error("❌ Error fetching reviews:", err);
    res.status(500).json({ error: "Failed to fetch reviews." });
  }
};

exports.getReviewsByProductId = async (req, res) => {
  try {
    const { product_id } = req.params;
    if (!product_id) return res.status(400).json({ error: "Product ID required" });

    const reviews = await Review.getReviewsByProductId(product_id);
    res.json({ reviews });
  } catch (err) {
    logger.error("❌ Error fetching reviews:", err);
    res.status(500).json({ error: "Failed to fetch reviews." });
  }
};



