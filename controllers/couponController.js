const logger = require("../utils/logger");
const couponModel = require("../models/couponModel");
const couponService = require('../services/couponService');
const pool = require("../config/db");

exports.getValidCouponsForProduct = async (req, res) => {
  try {
    const {
      product_id = null,
      variant_id = null,
      user_id = null,
      quantity = 1,
      order_amount = 0
    } = req.body;

    if (!product_id && !variant_id) {
      return res.status(400).json({ message: "product_id or variant_id required" });
    }

    // fetch all coupons that are active (and not expired)
    const [allCoupons] = await require('../config/db').query(`
        SELECT * FROM coupons WHERE is_active = 1
      `);

    const validCoupons = [];
    const invalidCoupons = [];

    // validate each coupon
    for (const c of allCoupons) {
      const result = await couponService.validateCoupon({
        code: c.code,
        user_id,
        product_id,
        variant_id,
        quantity,
        order_amount
      });

      if (result.valid) {
        validCoupons.push({
          coupon_id: result.coupon_id,
          code: c.code,
          description: c.description,
          discount_type: c.discount_type,
          discount_value: c.discount_value,
          applies_to: c.applies_to,
          discount: result.discount
        });
      } else {
        invalidCoupons.push({
          coupon_id: c.id,
          code: c.code,
          reasons: result.reasons
        });
      }
    }

    return res.status(200).json({
      valid_coupons: validCoupons,
      invalid_coupons: invalidCoupons
    });
  } catch (err) {
    logger.error("getValidCouponsForProduct error:", err);
    return res.status(500).json({ message: "internal server error" });
  }
};

exports.getValidCouponsForCart = async (req, res) => {
  try {
    const { user_id, items = [], total_amount = 0 } = req.body;

    if (!user_id) return res.status(400).json({ message: "user_id required" });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "cart items required" });
    }

    // 🔹 Fetch all currently active coupons (valid date range)
    const [coupons] = await pool.query(`
        SELECT * FROM coupons 
        WHERE is_active = 1 
        AND start_date <= NOW() 
        AND expiry_date >= NOW()
      `);

    const validCoupons = [];

    // 🔹 Loop through each coupon and validate
    for (const coupon of coupons) {
      const result = await couponService.validateCartCoupon({
        coupon,
        user_id,
        items,
        total_amount
      });

      if (result.valid) {
        validCoupons.push({
          coupon_id: coupon.id,
          code: coupon.code,
          description: coupon.description,
          discount_type: coupon.discount_type,
          discount_value: coupon.discount_value,
          applies_to: coupon.applies_to,
          discount_details: result.discount_details
        });
      }
    }

    return res.status(200).json({ valid_coupons: validCoupons });
  } catch (err) {
    logger.error("getValidCouponsForCart error:", err);
    return res.status(500).json({ message: "internal server error" });
  }
};

exports.validateCoupon = async (req, res) => {
  try {
    const {
      code,
      user_id = null,
      product_id = null,
      variant_id = null,
      quantity = 1,
      order_amount = 0
    } = req.body;

    // Basic input checks
    if (!code) {
      return res.status(400).json({ message: 'coupon code is required', coupon_id: null });
    }

    if ((product_id == null && variant_id == null) && req.body.context !== 'order') {
      // If user intends order-level validation they can pass context: 'order' or solely order_amount
      // otherwise at least one of product_id or variant_id is expected
      // But we won't hard-fail — we allow order-level validation if order_amount provided.
      if (!order_amount) {
        return res.status(400).json({
          message: 'Provide product_id or variant_id or validate as order-level by sending order_amount and context: "order"',
          coupon_id: null
        });
      }
    }

    const result = await couponService.validateCoupon({
      code,
      user_id,
      product_id,
      variant_id,
      quantity: Number(quantity || 1),
      order_amount: Number(order_amount || 0)
    });

    if (!result.valid) {
      return res.status(200).json({
        valid: false,
        coupon_id: null,
        reasons: result.reasons
      });
    }

    return res.status(200).json({
      valid: true,
      coupon_id: result.coupon_id,
      discount: result.discount,
      coupon: result.coupon
    });
  } catch (err) {
    logger.error('validateCoupon error', err);
    return res.status(500).json({ message: 'internal server error', coupon_id: null });
  }
};

exports.applyCoupon = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { code, user_id, cart_items = [], order_amount } = req.body;

    if (!code) return res.status(400).json({ success: false, message: "Coupon code is required" });
    if (!user_id) return res.status(400).json({ success: false, message: "User ID is required" });

    // 🟢 1️⃣ Fetch coupon
    const [couponRows] = await conn.query(`SELECT * FROM coupons WHERE code = ?`, [code]);
    if (!couponRows.length)
      return res.status(404).json({ success: false, message: "Invalid or non-existent coupon code" });

    const coupon = couponRows[0];
    const now = new Date();

    // DEBUG: Log coupon details right after fetching
    logger.info(`[applyCoupon] ✅ Coupon fetched: code=${coupon.code}, applies_to=${coupon.applies_to}, is_active=${coupon.is_active}`);

    // 🟢 2️⃣ Basic coupon validity checks
    if (!coupon.is_active)
      return res.json({ success: false, message: "This coupon is not active" });

    if (coupon.start_date && now < new Date(coupon.start_date))
      return res.json({ success: false, message: "Coupon has not started yet" });

    if (coupon.expiry_date && now > new Date(coupon.expiry_date))
      return res.json({ success: false, message: "Coupon has expired" });

    // 🟢 3️⃣ Check total and per-user usage (only count USED)
    if (coupon.usage_limit) {
      const [[orderCount]] = await conn.query(
        `SELECT COUNT(*) AS cnt FROM orders 
         WHERE order_coupon_id = ? AND order_status != 'CANCELLED'`,
        [coupon.id]
      );

      const [[itemCount]] = await conn.query(
        `SELECT COUNT(*) AS cnt FROM order_items oi 
         JOIN orders o ON oi.order_id = o.order_id 
         WHERE oi.coupon_id = ? AND oi.item_status != 'CANCELLED' AND o.order_status != 'CANCELLED'`,
        [coupon.id]
      );

      const globalUsedCount = orderCount.cnt + itemCount.cnt;

      if (globalUsedCount >= coupon.usage_limit)
        return res.json({ success: false, message: "Coupon global usage limit has been reached" });
    }

    if (coupon.per_user_limit) {
      // 1. Get order-level coupon occurrences in non-cancelled orders
      const [[orderCount]] = await conn.query(
        `SELECT COUNT(*) AS cnt FROM orders 
         WHERE order_coupon_id = ? AND user_id = ? AND order_status != 'CANCELLED'`,
        [coupon.id, user_id]
      );

      // 2. Get item-level coupon occurrences in non-cancelled orders
      const [[itemCount]] = await conn.query(
        `SELECT COUNT(*) AS cnt FROM order_items oi 
         JOIN orders o ON oi.order_id = o.order_id 
         WHERE oi.coupon_id = ? AND o.user_id = ? AND oi.item_status != 'CANCELLED' AND o.order_status != 'CANCELLED'`,
        [coupon.id, user_id]
      );

      const totalUsedCount = orderCount.cnt + itemCount.cnt;

      if (totalUsedCount >= coupon.per_user_limit)
        return res.json({ success: false, message: "You have already used this coupon the maximum number of times" });
    }

    // 🟢 4️⃣ Global min quantity check for bulk/bundle offers (like BUY3GET50)
    const totalQuantity = cart_items.reduce((sum, item) => sum + (item.quantity || 0), 0);
    if (coupon.min_quantity && totalQuantity < coupon.min_quantity) {
      return res.json({
        success: false,
        message: `You need to buy at least ${coupon.min_quantity} items to use this coupon`,
      });
    }

    // 🟢 5️⃣ Handle ORDER-level coupons (Check FIRST before any other level)
    const appliesAtOrderLevel = coupon.applies_to?.toLowerCase()?.trim() === "order";
    logger.info(`[applyCoupon] Coupon applies_to: "${coupon.applies_to}" (is order-level: ${appliesAtOrderLevel})`);

    if (appliesAtOrderLevel) {
      logger.info(`[applyCoupon] ✅ ORDER-LEVEL coupon detected. Applying to entire order.`);
      const minAmount = coupon.min_order_amount || 0;

      if (order_amount < minAmount) {
        return res.json({
          success: false,
          message: `Minimum order amount of ₹${minAmount} is required for this coupon`,
        });
      }

      let discount =
        coupon.discount_type === "flat"
          ? Number(coupon.discount_value)
          : (order_amount * Number(coupon.discount_value)) / 100;

      // Optional max discount cap (future-safe)
      if (coupon.max_discount && discount > coupon.max_discount) {
        discount = coupon.max_discount;
      }

      discount = Math.min(discount, order_amount);

      logger.info(`[applyCoupon] ✅ Order-level coupon applied successfully. Discount: ₹${discount}`);
      return res.json({
        success: true,
        level: "order",
        message: "Coupon applied successfully to entire order",
        order_coupon_id: coupon.id,
        discount_amount: Number(discount.toFixed(2)),
        coupon,
      });
    }

    // 🟢 6️⃣ Handle ITEM-level coupons (product / variant / category)
    const [couponVariants] = await conn.query(`SELECT variant_id FROM coupon_variants WHERE coupon_id = ?`, [coupon.id]);
    const [couponProducts] = await conn.query(`SELECT product_id FROM coupon_products WHERE coupon_id = ?`, [coupon.id]);
    const [couponCategories] = await conn.query(`SELECT category_id FROM coupon_categories WHERE coupon_id = ?`, [coupon.id]);

    // Extract IDs from database result objects
    const allowedVariantIds = couponVariants.map(v => Number(v.variant_id));
    const allowedProductIds = couponProducts.map(p => Number(p.product_id));
    const allowedCategoryIds = couponCategories.map(c => Number(c.category_id));

    const appliesTo = coupon.applies_to?.toLowerCase()?.trim();

    let eligibleItems = [];
    const cartVariantIds = [];
    const matchedVariantIds = [];

    for (const [index, item] of cart_items.entries()) {
      if (!item.product_id || !item.price) continue; // skip incomplete cart items

      let eligible = false;
      const itemVariantId = Number(item.variant_id);
      const itemProductId = Number(item.product_id);
      let itemCategoryId = Number(item.category_id || 0);

      // If category_id is not in cart item, fetch it from the product
      if (!itemCategoryId) {
        const [productData] = await conn.query(
          `SELECT category_id FROM products WHERE id = ?`,
          [itemProductId]
        );
        if (productData.length > 0) {
          itemCategoryId = Number(productData[0].category_id);
          logger.info(`[Coupon Validation] Item ${index}: Fetched category_id=${itemCategoryId} for product_id=${itemProductId}`);
        }
      }

      logger.info(`[Coupon Validation] Item ${index}: product_id=${itemProductId}, variant_id=${itemVariantId}, category_id=${itemCategoryId}`);

      // Collect cart variant IDs for logging
      if (itemVariantId) cartVariantIds.push(itemVariantId);

      // 🔴 STRICT VALIDATION - Variant Level (Most Restrictive)
      if (appliesTo === "variant") {
        logger.info(`[Coupon Validation] Item ${index}: VARIANT-LEVEL check - variant_id=${itemVariantId}, allowed=[${allowedVariantIds.join(",")}]`);
        // For variant-level coupons: ONLY apply to exact matching variants
        if (allowedVariantIds.length === 0) {
          // Coupon is marked as variant-level but has no variants assigned
          // This is a configuration error - reject
          logger.warn(`[Coupon Validation] ❌ Variant-level coupon has no variants mapped. Rejecting.`);
          continue;
        }

        eligible = allowedVariantIds.includes(itemVariantId);

        if (!eligible) {
          logger.info(`[Coupon Validation]  Variant ${itemVariantId} not in allowed list [${allowedVariantIds.join(", ")}]`);
        } else {
          matchedVariantIds.push(itemVariantId);
          logger.info(`[Coupon Validation]  Variant ${itemVariantId} matched`);
        }
      }
      // 🟡 PRODUCT Level (Applies to product and all its variants)
      else if (appliesTo === "product") {
        logger.info(`[Coupon Validation] Item ${index}: PRODUCT-LEVEL check - product_id=${itemProductId}, allowed_products=[${allowedProductIds.join(",")}], allowed_variants=[${allowedVariantIds.join(",")}]`);

        // If specific variants are linked (after update), only those variants qualify
        if (allowedVariantIds.length > 0) {
          logger.info(`[Coupon Validation] Product-level coupon has variant restrictions (this shouldn't happen after update)`);
          eligible = allowedVariantIds.includes(itemVariantId);
          if (eligible) {
            matchedVariantIds.push(itemVariantId);
            logger.info(`[Coupon Validation] Product variant ${itemVariantId} in allowed variant list`);
          }
        }
        // If specific products are linked, check product match AND apply to ALL its variants
        else if (allowedProductIds.length > 0) {
          const isProductMatch = allowedProductIds.includes(itemProductId);
          logger.info(`[Coupon Validation] Checking product ${itemProductId} against allowed [${allowedProductIds.join(",")}]: ${isProductMatch}`);

          if (isProductMatch) {
            // Product-level coupon with product restrictions: Apply to ALL variants of this product
            eligible = true;
            matchedVariantIds.push(itemVariantId);
            logger.info(`[Coupon Validation] ✅ Product ${itemProductId} matched - applying to ALL its variants (variant_id=${itemVariantId})`);
          } else {
            logger.info(`[Coupon Validation] ❌ Product ${itemProductId} NOT in allowed list [${allowedProductIds.join(", ")}]`);
          }
        }
        // No product/variant mappings = apply to all products and ALL their variants (global product coupon)
        else {
          eligible = true;
          matchedVariantIds.push(itemVariantId);
          logger.info(`[Coupon Validation] ✅ No product restrictions - apply to all products and all their variants`);
        }
      }
      // 🟢 CATEGORY Level
      else if (appliesTo === "category") {
        logger.info(`[Coupon Validation] Item ${index}: CATEGORY-LEVEL check - category_id=${itemCategoryId}, allowed=[${allowedCategoryIds.join(",")}]`);
        if (allowedCategoryIds.length > 0) {
          eligible = allowedCategoryIds.includes(itemCategoryId);
          logger.info(`[Coupon Validation] Category match result: ${eligible}`);
          if (eligible) {
            matchedVariantIds.push(itemVariantId);
            logger.info(`[Coupon Validation] ✅ Category ${itemCategoryId} matched - applying to product_id=${itemProductId}, variant_id=${itemVariantId}`);
          } else {
            logger.info(`[Coupon Validation] ❌ Category ${itemCategoryId} NOT in allowed list [${allowedCategoryIds.join(", ")}]`);
          }
        } else {
          // No category mappings = apply to all categories
          eligible = true;
          matchedVariantIds.push(itemVariantId);
          logger.info(`[Coupon Validation] ✅ No category restrictions - apply to all products and categories`);
        }
      }

      const quantity = item.quantity || 1;
      const totalItemPrice = item.price * quantity;

      // Check per-item min price / qty based on item row total
      const minAmount = coupon.min_order_amount || 0;
      const minQty = coupon.min_quantity || 0;

      const validByAmount = totalItemPrice >= minAmount;
      const validByQty = quantity >= minQty;

      if (eligible && validByAmount && validByQty) {
        let discount =
          coupon.discount_type === "flat"
            ? Number(coupon.discount_value)
            : (totalItemPrice * Number(coupon.discount_value)) / 100;

        // Optional max discount cap
        if (coupon.max_discount && discount > coupon.max_discount) {
          discount = coupon.max_discount;
        }

        const finalDiscount = Math.min(discount, totalItemPrice);

        eligibleItems.push({
          product_id: item.product_id,
          variant_id: item.variant_id,
          quantity: quantity,
          category_id: item.category_id,
          coupon_id: coupon.id,
          coupon_code: coupon.code,
          discount_amount: Number(finalDiscount.toFixed(2)),
        });
      } else if (!eligible) {
        logger.info(
          `[Coupon Validation] ❌ Item skipped - not eligible. ` +
          `Product: ${itemProductId}, Variant: ${itemVariantId}, Category: ${itemCategoryId}`
        );
      }
    }

    // DEBUG SUMMARY
    logger.info(`[Coupon Validation] Summary - applies_to: ${appliesTo}`);
    logger.info(`[Coupon Validation] Cart variants: [${cartVariantIds.join(", ")}]`);
    logger.info(`[Coupon Validation] Matched variants: [${matchedVariantIds.join(", ")}]`);
    logger.info(`[Coupon Validation] Eligible items count: ${eligibleItems.length}`);

    // 🔴 STRICT VARIANT VALIDATION: If coupon is variant-level and no matches found
    const isVariantLevelCoupon = appliesTo === "variant" || coupon.applies_to === "variant";
    logger.info(`[Coupon Validation] appliesTo="${appliesTo}" (type: ${typeof appliesTo})`);
    logger.info(`[Coupon Validation] coupon.applies_to="${coupon.applies_to}" (type: ${typeof coupon.applies_to})`);
    logger.info(`[Coupon Validation] Is variant-level coupon: ${isVariantLevelCoupon}`);
    logger.info(`[Coupon Validation] eligibleItems.length: ${eligibleItems.length}`);

    if (isVariantLevelCoupon && eligibleItems.length === 0) {
      logger.info(`[Coupon Validation] ❌ Variant-level coupon with no matching variants. Returning specific error message.`);
      return res.json({
        success: false,
        message: "Coupon is not applicable to this product variant",
      });
    }

    if (!eligibleItems.length) {
      return res.json({
        success: false,
        message: "Coupon is not applicable to any items in your cart",
      });
    }

    // ✅ Success response
    return res.json({
      success: true,
      level: "item",
      message: "Coupon applied successfully to eligible items only",
      eligible_items: eligibleItems,
      coupon,
    });
  } catch (err) {
    logger.error("❌ [Apply Coupon Error]:", err);
    return res.status(500).json({
      success: false,
      message: "An error occurred while applying the coupon",
      error: err.message,
    });
  } finally {
    if (conn) conn.release();
  }
};



exports.createCoupon = async (req, res) => {
  try {
    const {
      code, description, discount_type, discount_value,
      usage_limit, per_user_limit, min_order_amount, min_quantity,
      applies_to, priority, start_date, expiry_date, is_active,
      products, categories, variants
    } = req.body;

    // 1️⃣ Required field checks
    if (!code || !discount_type || discount_value == null || !expiry_date) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!['flat', 'percentage'].includes(discount_type)) {
      return res.status(400).json({ error: "discount_type must be 'flat' or 'percentage'" });
    }

    if (discount_type === "percentage" && discount_value > 100) {
      return res.status(400).json({ error: "Percentage discount cannot exceed 100%" });
    }

    // 2️⃣ Numeric validations
    if (Number(discount_value) < 0) return res.status(400).json({ error: "discount_value must be >= 0" });
    if (usage_limit && Number(usage_limit) < 0) return res.status(400).json({ error: "usage_limit must be >= 0" });
    if (per_user_limit && Number(per_user_limit) < 0) return res.status(400).json({ error: "per_user_limit must be >= 0" });
    if (min_order_amount && Number(min_order_amount) < 0) return res.status(400).json({ error: "min_order_amount must be >= 0" });
    if (min_quantity && Number(min_quantity) < 0) return res.status(400).json({ error: "min_quantity must be >= 0" });

    // 3️⃣ applies_to validations
    if (applies_to && !['order', 'product', 'category'].includes(applies_to)) {
      return res.status(400).json({ error: "applies_to must be 'order', 'product', or 'category'" });
    }
    if (applies_to === 'product' && (!products?.length && !variants?.length)) {
      return res.status(400).json({ error: "Must provide products or variants for product-specific coupon" });
    }
    if (applies_to === 'category' && (!categories?.length)) {
      return res.status(400).json({ error: "Must provide categories for category-specific coupon" });
    }

    // 4️⃣ Prepare coupon object
    const couponData = {
      code,
      description: description || null,
      discount_type,
      discount_value: Number(discount_value),
      usage_limit: usage_limit ?? 0,
      per_user_limit: per_user_limit ?? 1,
      min_order_amount: min_order_amount ?? 0,
      min_quantity: min_quantity ?? null,
      applies_to: applies_to || 'order',
      priority: priority ?? 1,
      start_date: start_date || new Date(),
      expiry_date,
      is_active: is_active ?? 1
    };

    // 5️⃣ Insert via model
    const couponId = await couponModel.createCoupon(couponData, products || [], categories || [], variants || []);

    res.status(201).json({ message: "Coupon created successfully", id: couponId });

  } catch (err) {
    logger.error("Create Coupon Error:", err);
    if (err.code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "Coupon code already exists" });
    res.status(500).json({ error: "Internal Server Error" });
  }
};


// ✅ Get All Coupons
exports.getCoupons = async (req, res) => {
  try {
    const coupons = await couponModel.getCoupons();
    res.json(coupons);
  } catch (err) {
    logger.error("Get Coupons Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// ✅ Get Coupon by ID
exports.getCouponById = async (req, res) => {
  try {
    const coupon = await couponModel.getCouponById(req.params.id);
    if (!coupon) return res.status(404).json({ error: "Coupon not found" });
    res.json(coupon);
  } catch (err) {
    logger.error("Get Coupon Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// ✅ Update Coupon - With support for level changes (order ↔ product ↔ variant ↔ category)
exports.updateCoupon = async (req, res) => {
  try {
    const couponId = req.params.id;
    const { discount_type, discount_value, applies_to, products, categories, variants } = req.body;

    // Validate discount percentage
    if (discount_type === "percentage" && discount_value > 100) {
      return res.status(400).json({ error: "Percentage discount cannot exceed 100%" });
    }

    // 🔴 LOG EVERYTHING RECEIVED FROM FRONTEND
    logger.info(`\n[UpdateCoupon] ========== BACKEND RECEIVED ==========`);
    logger.info(`[UpdateCoupon] Coupon ID: ${couponId}`);
    logger.info(`[UpdateCoupon] All fields received from frontend:`, {
      code: req.body.code,
      description: req.body.description,
      discount_type: req.body.discount_type,
      discount_value: req.body.discount_value,
      usage_limit: req.body.usage_limit,
      per_user_limit: req.body.per_user_limit,
      min_order_amount: req.body.min_order_amount,
      min_quantity: req.body.min_quantity,
      applies_to: req.body.applies_to,
      priority: req.body.priority,
      start_date: req.body.start_date,
      expiry_date: req.body.expiry_date,
      is_active: req.body.is_active,
    });

    logger.info(`[UpdateCoupon] Product/Variant/Category arrays:`, {
      products: products,
      categories: categories,
      variants: variants
    });

    logger.info(`[UpdateCoupon] New applies_to level: ${applies_to}`);

    // 🔴 CRITICAL: When changing applies_to level, ensure old mappings are cleared
    // The model will delete ALL mappings before inserting new ones
    const updated = await couponModel.updateCoupon(
      couponId,
      req.body,
      Array.isArray(products) ? products : [],    // Ensure product array is passed
      Array.isArray(categories) ? categories : [], // Ensure categories array is passed
      Array.isArray(variants) ? variants : []      // Ensure variants array is passed
    );

    if (!updated) {
      return res.status(404).json({ error: "Coupon not found" });
    }

    logger.info(`[UpdateCoupon] ✅ Coupon ${couponId} updated successfully\n`);
    res.json({
      message: "Coupon updated successfully",
      coupon_id: couponId,
      applies_to_level: applies_to,
      note: `Coupon is now at ${applies_to} level. Old product/variant/category mappings have been cleared.`
    });
  } catch (err) {
    logger.error("Update Coupon Error:", err);
    res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
};

// ✅ Activate / Deactivate
exports.toggleCoupon = async (req, res) => {
  try {
    const { active } = req.body;
    const success = await couponModel.setCouponActiveState(req.params.id, active);
    if (!success) return res.status(404).json({ error: "Coupon not found" });
    res.json({ message: `Coupon ${active ? "activated" : "deactivated"} successfully` });
  } catch (err) {
    logger.error("Toggle Coupon Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};


// ✅ Soft Delete (Deactivate)
exports.deleteCoupon = async (req, res) => {
  try {
    const deleted = await couponModel.deleteCoupon(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Coupon not found" });
    res.json({ message: "Coupon deactivated" });
  } catch (err) {
    logger.error("Delete Coupon Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// ✅ Restore Coupon
exports.restoreCoupon = async (req, res) => {
  try {
    const restored = await couponModel.restoreCoupon(req.params.id);
    if (!restored) return res.status(404).json({ error: "Coupon not found" });
    res.json({ message: "Coupon restored" });
  } catch (err) {
    logger.error("Restore Coupon Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.getNotActiveCoupons = async (req, res) => {
  try {
    const coupons = await couponModel.getNotActiveCoupons();
    res.json(coupons);
  } catch (err) {
    logger.error("Error fetching inactive coupons:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.getCouponsForProduct = async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    if (!productId) return res.status(400).json({ error: "Invalid product ID" });

    const productCoupons = await couponModel.getCouponsForProduct(productId);

    res.json(productCoupons);
  } catch (err) {
    logger.error("Get Product Coupons Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// ---------------------
// Category Coupons with Discount
// ---------------------
exports.getCouponsForCategory = async (req, res) => {
  try {
    const categoryId = parseInt(req.params.categoryId);
    if (!categoryId) return res.status(400).json({ error: "Invalid category ID" });

    const categoryCoupons = await couponModel.getCouponsForCategory(categoryId);

    res.json(categoryCoupons);
  } catch (err) {
    logger.error("Get Category Coupons Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.createCoupon = async (req, res) => {
  try {
    const {
      code,
      description,
      discount_type,
      discount_value,
      usage_limit,
      per_user_limit,
      min_order_amount,
      min_quantity,
      applies_to,
      priority,
      start_date,
      expiry_date,
      is_active,
      products,
      categories,
      variants,
    } = req.body;

    if (!code || !discount_type || !discount_value || !expiry_date) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (discount_type === "percentage" && discount_value > 100) {
      return res.status(400).json({ error: "Percentage discount cannot exceed 100%" });
    }

    const couponId = await couponModel.createCoupon(
      {
        code,
        description,
        discount_type,
        discount_value,
        usage_limit,
        per_user_limit,
        min_order_amount,
        min_quantity,
        applies_to,
        priority,
        start_date,
        expiry_date,
        is_active,
      },
      products || [],
      categories || [],
      variants || []
    );

    res.status(201).json({ message: "Coupon created successfully", id: couponId });
  } catch (err) {
    logger.error("Create Coupon Error:", err);
    if (err.code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "Coupon code already exists" });
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// ✅ Get All Coupons
exports.getCoupons = async (req, res) => {
  try {
    const coupons = await couponModel.getCoupons();
    res.json(coupons);
  } catch (err) {
    logger.error("Get Coupons Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};



// ✅ Get Coupon by ID (with linked products, variants, categories)
exports.getCouponById = async (req, res) => {
  try {
    const coupon = await couponModel.getCouponById(req.params.id);
    if (!coupon) return res.status(404).json({ error: "Coupon not found" });

    // Fetch linked products, variants, and categories
    const products = await couponModel.getCouponProducts(coupon.id);
    const variants = await couponModel.getCouponVariants(coupon.id);
    const categories = await couponModel.getCouponCategories(coupon.id);

    res.json({ ...coupon, products, variants, categories });
  } catch (err) {
    logger.error("Get Coupon Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Note: updateCoupon, toggleCoupon, deleteCoupon defined earlier in this file

// ✅ Activate / Deactivate
exports.toggleCoupon = async (req, res) => {
  try {
    const { active } = req.body;
    const success = await couponModel.setCouponActiveState(req.params.id, active);
    if (!success) return res.status(404).json({ error: "Coupon not found" });
    res.json({ message: `Coupon ${active ? "activated" : "deactivated"} successfully` });
  } catch (err) {
    logger.error("Toggle Coupon Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};


// ✅ Soft Delete (Deactivate)
exports.deleteCoupon = async (req, res) => {
  try {
    const deleted = await couponModel.deleteCoupon(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Coupon not found" });
    res.json({ message: "Coupon deactivated" });
  } catch (err) {
    logger.error("Delete Coupon Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// ✅ Restore Coupon
exports.restoreCoupon = async (req, res) => {
  try {
    const restored = await couponModel.restoreCoupon(req.params.id);
    if (!restored) return res.status(404).json({ error: "Coupon not found" });
    res.json({ message: "Coupon restored" });
  } catch (err) {
    logger.error("Restore Coupon Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.getNotActiveCoupons = async (req, res) => {
  try {
    const coupons = await couponModel.getNotActiveCoupons();
    res.json(coupons);
  } catch (err) {
    logger.error("Error fetching inactive coupons:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.getCouponsForProduct = async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    if (!productId) return res.status(400).json({ error: "Invalid product ID" });

    const productCoupons = await couponModel.getCouponsForProduct(productId);

    res.json(productCoupons);
  } catch (err) {
    logger.error("Get Product Coupons Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// ---------------------
// Category Coupons with Discount
// ---------------------
exports.getCouponsForCategory = async (req, res) => {
  try {
    const categoryId = parseInt(req.params.categoryId);
    if (!categoryId) return res.status(400).json({ error: "Invalid category ID" });

    const categoryCoupons = await couponModel.getCouponsForCategory(categoryId);

    res.json(categoryCoupons);
  } catch (err) {
    logger.error("Get Category Coupons Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};