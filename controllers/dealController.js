const logger = require("../utils/logger");
const dealModel = require("../models/dealModel");

const toMySQLDate = (d) => {
  if (!d) return null;
  return new Date(d).toISOString().slice(0,19).replace("T"," ");
};

// ✅ Create Deal
// ✅ Create Deal
// ================= CREATE DEAL =================
exports.createDeal = async (req, res) => {
  try {
    const {
      product_id,
      product_variant_id,
      deal_price,
      start_date,
      end_date,
      is_active,
    } = req.body;

    // ✅ Required fields validation
    if (!product_id || !deal_price || !start_date || !end_date) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // ✅ Optional variant validation (format)
    if (
      product_variant_id !== undefined &&
      product_variant_id !== null &&
      (!Number.isInteger(Number(product_variant_id)) ||
        Number(product_variant_id) <= 0)
    ) {
      return res.status(400).json({
        error: "Invalid product_variant_id",
      });
    }

    const mysqlStart = toMySQLDate(start_date);
    const mysqlEnd = toMySQLDate(end_date);

    if (new Date(mysqlStart) >= new Date(mysqlEnd)) {
      return res.status(400).json({ error: "Invalid date range" });
    }

    // ✅ Variant ownership check (DB-level)
    if (product_variant_id) {
      const isValid = await dealModel.isVariantOfProduct(
        product_id,
        product_variant_id
      );

      if (!isValid) {
        return res.status(400).json({
          error: "Variant does not belong to the given product",
        });
      }
    }

    const id = await dealModel.createDeal({
      product_id,
      product_variant_id: product_variant_id || null,
      deal_price,
      start_date: mysqlStart,
      end_date: mysqlEnd,
      is_active,
    });

    res.status(201).json({
      message: "Deal created successfully",
      id,
    });
  } catch (err) {
    logger.error("Create Deal Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// ================= UPDATE DEAL =================
exports.updateDeal = async (req, res) => {
  try {
    const {
      product_id,
      product_variant_id,
      deal_price,
      start_date,
      end_date,
      is_active,
    } = req.body;

    // ✅ Required fields validation
    if (!product_id || !deal_price || !start_date || !end_date) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // ✅ Optional variant validation (format)
    if (
      product_variant_id !== undefined &&
      product_variant_id !== null &&
      (!Number.isInteger(Number(product_variant_id)) ||
        Number(product_variant_id) <= 0)
    ) {
      return res.status(400).json({
        error: "Invalid product_variant_id",
      });
    }

    const mysqlStart = toMySQLDate(start_date);
    const mysqlEnd = toMySQLDate(end_date);

    if (new Date(mysqlStart) >= new Date(mysqlEnd)) {
      return res.status(400).json({ error: "Invalid date range" });
    }

    // ✅ Variant ownership check (DB-level)
    if (product_variant_id) {
      const isValid = await dealModel.isVariantOfProduct(
        product_id,
        product_variant_id
      );

      if (!isValid) {
        return res.status(400).json({
          error: "Variant does not belong to the given product",
        });
      }
    }

    const updated = await dealModel.updateDeal(req.params.id, {
      product_id,
      product_variant_id: product_variant_id || null,
      deal_price,
      start_date: mysqlStart,
      end_date: mysqlEnd,
      is_active,
    });

    if (!updated) {
      return res.status(404).json({ error: "Deal not found" });
    }

    res.json({ message: "Deal updated successfully" });
  } catch (err) {
    logger.error("Update Deal Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};


// ✅ Get Active Deal By Product ID
exports.getActiveDealByProduct = async (req, res) => {
  try {
    const deal = await dealModel.getActiveDealByProductId(
      req.params.productId
    );

    if (!deal) {
      return res.status(404).json({
        message: "No active deal found for this product",
      });
    }

    res.json(deal);
  } catch (err) {
    logger.error("Product Deal Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};


exports.getActiveDealByVariant = async (req, res) => {
  try {
    const deal = await dealModel.getActiveDealByVariantId(
      req.params.variantId
    );

if (!deal) {
  return res.status(200).json(null);
}
    res.json(deal);
  } catch (err) {
    logger.error("Variant Deal Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};



// ✅ Get All Deals
exports.getDeals = async (req, res) => {
  try {
    const deals = await dealModel.getDeals();
    res.json(deals);
  } catch (err) {
    logger.error("Get Deals Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// ✅ Get Active Deals
exports.getActiveDeals = async (req, res) => {
  try {
    const deals = await dealModel.getActiveDeals();
    res.json(deals);
  } catch (err) {
    logger.error("Get Active Deals Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// ✅ Get Deal By ID
exports.getDealById = async (req, res) => {
  try {
    const deal = await dealModel.getDealById(req.params.id);
    if (!deal) {
      return res.status(404).json({ error: "Deal not found" });
    }
    res.json(deal);
  } catch (err) {
    logger.error("Get Deal Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};


// ✅ Delete Deal
exports.deleteDeal = async (req, res) => {
  try {
    const deleted = await dealModel.deleteDeal(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "Deal not found" });
    }
    res.json({ message: "Deal deleted successfully" });
  } catch (err) {
    logger.error("Delete Deal Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
