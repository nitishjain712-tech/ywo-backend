const logger = require("../utils/logger");
// services/couponService.js
const CouponModel = require('../models/couponModel');
const ProductModel = require('../models/productModel');

const pool = require("../config/db");

const isDateBetween = (start, end, now = new Date()) => {
  if (start && new Date(start) > now) return false;
  if (end && new Date(end) < now) return false;
  return true;
};

/**
 * Validate coupon for a product/order context
 *
 * params:
 *  - code (string) coupon code
 *  - user_id (int|null)
 *  - product_id (int|null)
 *  - variant_id (int|null)
 *  - quantity (int) quantity of variant/product requested
 *  - order_amount (decimal) total order amount (pre-discount)
 *
 * Returns:
 *  {
 *    valid: boolean,
 *    coupon_id: number|null,
 *    reasons: string[],   // if invalid, list of reasons
 *    discount: { amount: number, type: 'flat'|'percentage', applied_on: 'order'|'product'|'variant' },
 *    coupon: {...} // optional coupon object
 *  }
 */
async function validateCoupon({
  code,
  user_id = null,
  product_id = null,
  variant_id = null,
  quantity = 1,
  order_amount = 0
}) {
  const reasons = [];
  const now = new Date();

  if (!code) {
    return { valid: false, coupon_id: null, reasons: ['Coupon code not provided'] };
  }

  const coupon = await CouponModel.getCouponByCode(code);
  if (!coupon) {
    return { valid: false, coupon_id: null, reasons: ['Coupon not found'] };
  }

  // 🔹 1️⃣ Active check
  if (!coupon.is_active) {
    reasons.push('Coupon is not active');
  }

  // 🔹 2️⃣ Date validity
  const startDate = coupon.start_date ? new Date(coupon.start_date) : null;
  const expiryDate = coupon.expiry_date ? new Date(coupon.expiry_date) : null;
  if (startDate && startDate > now) reasons.push(`Coupon not started yet`);
  if (expiryDate && expiryDate < now) reasons.push(`Coupon expired`);

  // 🔹 3️⃣ Usage limits
  if (coupon.usage_limit && Number(coupon.usage_limit) > 0) {
    const [[orderCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM orders WHERE order_coupon_id = ? AND order_status != 'CANCELLED'`,
      [coupon.id]
    );
    const [[itemCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM order_items oi 
       JOIN orders o ON oi.order_id = o.order_id 
       WHERE oi.coupon_id = ? AND oi.item_status != 'CANCELLED' AND o.order_status != 'CANCELLED'`,
      [coupon.id]
    );
    if ((orderCount.cnt + itemCount.cnt) >= coupon.usage_limit) {
      reasons.push('Coupon global usage limit reached');
    }
  }

  if (user_id && coupon.per_user_limit && Number(coupon.per_user_limit) > 0) {
    const [[orderCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM orders WHERE order_coupon_id = ? AND user_id = ? AND order_status != 'CANCELLED'`,
      [coupon.id, user_id]
    );
    const [[itemCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM order_items oi 
       JOIN orders o ON oi.order_id = o.order_id 
       WHERE oi.coupon_id = ? AND o.user_id = ? AND oi.item_status != 'CANCELLED' AND o.order_status != 'CANCELLED'`,
      [coupon.id, user_id]
    );
    if ((orderCount.cnt + itemCount.cnt) >= coupon.per_user_limit) {
      reasons.push('You have already used this coupon maximum allowed times');
    }
  }

  // 🔹 4️⃣ Minimum order amount
  if (coupon.min_order_amount && Number(coupon.min_order_amount) > 0) {
    if (Number(order_amount) < Number(coupon.min_order_amount)) {
      reasons.push(`Order amount ₹${order_amount} is below minimum ₹${coupon.min_order_amount}`);
    }
  }

  // 🔹 5️⃣ Minimum quantity (for product/variant)
  if (coupon.min_quantity && Number(coupon.min_quantity) > 0) {
    if (Number(quantity) < Number(coupon.min_quantity)) {
      reasons.push(`Minimum quantity required is ${coupon.min_quantity}`);
    }
  }

  // 🔹 6️⃣ Applicability Check
  const appliesTo = coupon.applies_to || 'order';
  const productApplicable = async () => {
    if (appliesTo === 'order') return true;

    const productList = await CouponModel.getCouponProducts(coupon.id);
    const variantList = await CouponModel.getCouponVariants(coupon.id);
    const categoryList = await CouponModel.getCouponCategories(coupon.id);

    logger.info(`[CouponService] Validating applies_to: ${appliesTo}, variant_id: ${variant_id}, product_id: ${product_id}`);
    logger.info(`[CouponService] Allowed variants: [${variantList.join(", ")}]`);
    logger.info(`[CouponService] Allowed products: [${productList.join(", ")}]`);
    logger.info(`[CouponService] Allowed categories: [${categoryList.join(", ")}]`);

    // 🔴 STRICT VARIANT-LEVEL VALIDATION
    if (appliesTo === 'variant') {
      // Variant-level coupon must have exact variant match
      if (variant_id) {
        const variantMatch = variantList.length > 0 && variantList.includes(Number(variant_id));
        logger.info(`[CouponService] Variant-level check: variant_id=${variant_id}, match=${variantMatch}`);

        if (!variantMatch) {
          logger.info(`[CouponService] ❌ Variant ${variant_id} not in allowed list. Strict variant validation failed.`);
          return false;
        }
        return true;
      }
      // No variant_id provided but coupon is variant-level - cannot validate
      logger.info(`[CouponService] ❌ Coupon is variant-level but no variant_id provided`);
      return false;
    }

    // 🟡 PRODUCT-LEVEL VALIDATION
    if (appliesTo === 'product') {
      if (variant_id) {
        // If product has variant restrictions, check variant first
        if (variantList.length > 0) {
          const variantMatch = variantList.includes(Number(variant_id));
          logger.info(`[CouponService] Product-level with variant restrictions: variant_id=${variant_id}, match=${variantMatch}`);
          return variantMatch;
        }

        // No variant restrictions, check product
        const variant = await ProductModel.getVariantById(variant_id);
        if (!variant) return false;
        const pid = variant.product_id;

        if (productList.length > 0) {
          const productMatch = productList.includes(Number(pid));
          logger.info(`[CouponService] Product-level: product_id=${pid}, match=${productMatch}`);
          return productMatch;
        }

        // No product restrictions, apply to all products
        return true;
      }

      if (product_id) {
        if (productList.length > 0) {
          const productMatch = productList.includes(Number(product_id));
          logger.info(`[CouponService] Product-level: product_id=${product_id}, match=${productMatch}`);
          return productMatch;
        }
        return true;
      }

      return false;
    }

    // 🟢 CATEGORY-LEVEL VALIDATION
    if (appliesTo === 'category') {
      if (variant_id) {
        const variant = await ProductModel.getVariantById(variant_id);
        if (!variant) return false;
        const pid = variant.product_id;

        if (categoryList.length > 0) {
          const cats = await ProductModel.getProductCategoryIds(pid);
          const categoryMatch = cats.some(c => categoryList.includes(Number(c)));
          logger.info(`[CouponService] Category-level: product_id=${pid}, categories=[${cats}], match=${categoryMatch}`);
          return categoryMatch;
        }
        return true;
      }

      if (product_id) {
        if (categoryList.length > 0) {
          const cats = await ProductModel.getProductCategoryIds(product_id);
          const categoryMatch = cats.some(c => categoryList.includes(Number(c)));
          logger.info(`[CouponService] Category-level: product_id=${product_id}, categories=[${cats}], match=${categoryMatch}`);
          return categoryMatch;
        }
        return true;
      }

      return false;
    }

    return appliesTo === 'order';
  };

  const applicable = await productApplicable();
  if (!applicable) {
    if (appliesTo === 'variant') {
      reasons.push(`Coupon is not applicable to this product variant`);
    } else {
      reasons.push(`Coupon does not apply to this ${appliesTo}`);
    }
  }

  // 🔹 7️⃣ If invalid so far, stop here
  if (reasons.length) {
    return { valid: false, coupon_id: coupon.id, reasons };
  }

  // 🔹 8️⃣ Calculate discount
  let discountAmount = 0;
  try {
    if (appliesTo === 'order') {
      if (coupon.discount_type === 'flat') {
        discountAmount = Number(coupon.discount_value);
      } else {
        discountAmount = (Number(order_amount) * Number(coupon.discount_value)) / 100;
      }
    } else {
      let unitPrice = 0;
      if (variant_id) {
        const variant = await ProductModel.getVariantById(variant_id);
        if (variant) unitPrice = Number(variant.price || 0);
      }
      if (!unitPrice && order_amount && quantity > 0) {
        unitPrice = Number(order_amount) / Number(quantity);
      }

      if (coupon.discount_type === 'flat') {
        discountAmount = Number(coupon.discount_value) * Number(quantity);
      } else {
        discountAmount = (unitPrice * Number(quantity) * Number(coupon.discount_value)) / 100;
      }
    }
  } catch (err) {
    reasons.push('Could not calculate exact discount amount');
  }

  // 🔹 9️⃣ Prevent negative or free total
  if (discountAmount >= order_amount) {
    discountAmount = Math.max(order_amount - 1, 0);
  }

  // 🔹 1️⃣0️⃣ Final valid response
  return {
    valid: true,
    coupon_id: coupon.id,
    coupon,
    reasons: [],
    discount: {
      amount: Number(discountAmount.toFixed(2)),
      type: coupon.discount_type,
      applied_on: appliesTo
    },
    message: `Coupon applied successfully. ₹${Number(discountAmount.toFixed(2))} discount applied`
  };
};


async function validateCartCoupon({ coupon, user_id, items, total_amount }) {
  // 1️⃣ Basic validations
  if (!coupon.is_active) return { valid: false, reason: "Coupon inactive" };
  if (new Date(coupon.expiry_date) < new Date()) return { valid: false, reason: "Coupon expired" };
  if (new Date(coupon.start_date) > new Date()) return { valid: false, reason: "Coupon not started yet" };

  // 2️⃣ Usage limits
  if (coupon.usage_limit && Number(coupon.usage_limit) > 0) {
    const [[orderCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM orders WHERE order_coupon_id = ? AND order_status != 'CANCELLED'`,
      [coupon.id]
    );
    const [[itemCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM order_items oi 
         JOIN orders o ON oi.order_id = o.order_id 
         WHERE oi.coupon_id = ? AND oi.item_status != 'CANCELLED' AND o.order_status != 'CANCELLED'`,
      [coupon.id]
    );
    if ((orderCount.cnt + itemCount.cnt) >= coupon.usage_limit) {
      return { valid: false, reason: "Coupon usage limit reached" };
    }
  }

  if (user_id && coupon.per_user_limit && Number(coupon.per_user_limit) > 0) {
    const [[orderCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM orders WHERE order_coupon_id = ? AND user_id = ? AND order_status != 'CANCELLED'`,
      [coupon.id, user_id]
    );
    const [[itemCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM order_items oi 
         JOIN orders o ON oi.order_id = o.order_id 
         WHERE oi.coupon_id = ? AND o.user_id = ? AND oi.item_status != 'CANCELLED' AND o.order_status != 'CANCELLED'`,
      [coupon.id, user_id]
    );
    if ((orderCount.cnt + itemCount.cnt) >= coupon.per_user_limit) {
      return { valid: false, reason: "User limit reached" };
    }
  }

  // 3️⃣ Check minimum order total
  if (total_amount < coupon.min_order_amount)
    return { valid: false, reason: "Minimum order amount not met" };

  // 4️⃣ Check minimum quantity
  const totalQty = items.reduce((sum, it) => sum + it.quantity, 0);
  if (coupon.min_quantity && totalQty < coupon.min_quantity)
    return { valid: false, reason: "Minimum quantity not met" };

  // 5️⃣ Eligibility by applies_to level
  let eligible = false;

  if (coupon.applies_to === 'order') {
    eligible = true; // applies to all orders
  } else if (coupon.applies_to === 'category') {
    const [cats] = await pool.query(
      `SELECT category_id FROM coupon_categories WHERE coupon_id = ?`,
      [coupon.id]
    );
    const eligibleCats = cats.map(c => c.category_id);
    eligible = items.some(i => eligibleCats.includes(i.category_id));
  } else if (coupon.applies_to === 'product') {
    const [prods] = await pool.query(
      `SELECT product_id FROM coupon_products WHERE coupon_id = ?`,
      [coupon.id]
    );
    const eligibleProducts = prods.map(p => p.product_id);
    eligible = items.some(i => eligibleProducts.includes(i.product_id));
  } else if (coupon.applies_to === 'variant') {
    const [vars] = await pool.query(
      `SELECT variant_id FROM coupon_variants WHERE coupon_id = ?`,
      [coupon.id]
    );
    const eligibleVariants = vars.map(v => v.variant_id);
    eligible = items.some(i => eligibleVariants.includes(i.variant_id));
  }

  if (!eligible) return { valid: false, reason: "Coupon not applicable to any cart item" };

  // 6️⃣ Calculate potential discount
  let discountAmount = 0;

  if (coupon.discount_type === 'flat') {
    discountAmount = coupon.discount_value;
  } else if (coupon.discount_type === 'percentage') {
    discountAmount = (total_amount * coupon.discount_value) / 100;
  }

  return {
    valid: true,
    coupon_id: coupon.id,
    discount_details: {
      amount: discountAmount,
      type: coupon.discount_type,
      applied_on: coupon.applies_to
    }
  };
}


module.exports = {
  validateCoupon,
  validateCartCoupon
};
