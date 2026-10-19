const logger = require("../utils/logger");
const Review = require("../models/reviewModel");
const { updateProductAvgRating } = require("../models/productModel");

exports.createFakeReview = async (req, res) => {
  try {
    const admin_id = req.admin?.id;
    if (!admin_id) return res.status(401).json({ error: "Unauthorized" });

    const { product_id, rating, comment = "", is_verified_purchase = false, } = req.body;

    if (!product_id || !rating)
      return res.status(400).json({ error: "Missing required fields" });

    if (rating < 1 || rating > 5)
      return res.status(400).json({ error: "Rating must be between 1-5" });

const id = await Review.createAdminReview({
  admin_id,
  product_id,
  rating,
  comment,
  is_verified_purchase,
});
     // Update product avg rating
        await updateProductAvgRating(product_id);

    res.status(201).json({ message: "Admin review added", review_id: id });
  } catch (err) {
    logger.error("❌ Admin create review error:", err);
    res.status(500).json({ error: "Failed to create admin review" , error: err});
  }
};

exports.verifyReview = async (req, res) => {
  try {
    const admin_id = req.admin?.id;
    const { id } = req.params;
    if (!admin_id) return res.status(401).json({ error: "Unauthorized" });
    if (!id) return res.status(400).json({ error: "Review ID required" });

    await Review.verifyReview(admin_id, id);
    res.json({ message: "Review verified successfully" });
  } catch (err) {
    if (err.message.includes("not found"))
      return res.status(404).json({ error: err.message });

    logger.error("❌ Verify review error:", err);
    res.status(500).json({ error: "Failed to verify review" });
  }
};

exports.rejectReview = async (req, res) => {
  try {
    const admin_id = req.admin?.id;
    const { id } = req.params;
    if (!admin_id) return res.status(401).json({ error: "Unauthorized" });
    if (!id) return res.status(400).json({ error: "Review ID required" });

    await Review.rejectReview(admin_id, id);
    res.json({ message: "Review rejected successfully" });
  } catch (err) {
    if (err.message.includes("not found"))
      return res.status(404).json({ error: err.message });

    logger.error("❌ Reject review error:", err);
    res.status(500).json({ error: "Failed to reject review" });
  }
};

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
}

exports.deleteAdminReviewSoftly = async (req, res) => {
  try {
    const admin_id = req.admin?.id;
    const { id } = req.params;
    if (!admin_id) return res.status(401).json({ error: "Unauthorized" });
    if (!id) return res.status(400).json({ error: "Review ID required" });

    await Review.deleteAdminReviewSoftly(admin_id, id);
    res.json({ message: "Review Softly deleted successfully" });
  } catch (err) {
    if (err.message.includes("not found"))
      return res.status(404).json({ error: err.message });

    logger.error("❌ Delete review error:", err);
    res.status(500).json({ error: "Failed to delete review" });
  }
};

exports.deleteReviewPermanentlyById = async (req, res) => {
  try {
    const admin_id = req.admin?.id;
    const { id } = req.params;
    if (!admin_id) return res.status(401).json({ error: "Unauthorized" });
    if (!id) return res.status(400).json({ error: "Review ID required" });

    await Review.deleteReviewPermanentlyById(id);
    res.json({ message: "Review deleted permanently successfully" });
  } catch (err) {
    if (err.message.includes("not found"))
      return res.status(404).json({ error: err.message });

    logger.error("❌ Error deleting review:", err);
    res.status(500).json({ error: "Failed to delete review" });
  }
};

exports.getAllPendingReviews = async (req, res) => {
  try {
    const reviews = await Review.getAllPendingReviews();
    res.json({ reviews });
  } catch (err) {
    logger.error("❌ Error fetching reviews:", err);
    res.status(500).json({ error: "Failed to fetch reviews." });
  }
};

exports.getAllRejectedReviews = async (req, res) => {
  try {
    const reviews = await Review.getAllRejectedReviews();
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

exports.getSoftlyDeletedReviews = async (req, res) => {
  try {
    const reviews = await Review.getSoftlyDeletedReviews();
    res.json({ reviews });
  } catch (err) {
    logger.error("❌ Error fetching reviews:", err);
    res.status(500).json({ error: "Failed to fetch reviews." });
  }
};

exports.getAllAdminReviews = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 200;
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || "";
    const productId = req.query.product_id || "all";
    const offset = (page - 1) * limit;

    const data = await Review.getAllAdminReviews(limit, offset, search, productId);
    logger.info(`[getAllAdminReviews] Fetching reviews: page=${page}, limit=${limit}, search=${search}, productId=${productId}, total=${data.total}`);
    res.json(data);
  } catch (err) {
    logger.error("❌ Error fetching all reviews:", err);
    res.status(500).json({ error: "Failed to fetch all reviews." });
  }
};


