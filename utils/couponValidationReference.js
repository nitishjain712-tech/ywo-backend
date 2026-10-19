/**
 * COUPON VARIANT VALIDATION - QUICK REFERENCE GUIDE
 * 
 * Use this guide to understand the new validation logic at a glance.
 */

// ============================================
// VALIDATION DECISION TREE
// ============================================

const VALIDATION_DECISION_TREE = `

┌─ START: Validate Coupon for Cart Item
│
├─ Is coupon applies_to === "ORDER"?
│  ├─ YES → ✅ Apply to entire order, skip to discount calculation
│  └─ NO → Continue
│
├─ Is coupon applies_to === "VARIANT"?
│  ├─ YES → STRICT VARIANT VALIDATION
│  │   ├─ Are variant restrictions defined (coupon_variants table)?
│  │   │  ├─ NO → ⚠️ Configuration Error → ❌ Reject (never apply)
│  │   │  └─ YES → Check if item.variant_id in allowed_variants
│  │   │      ├─ YES → ✅ Apply discount
│  │   │      └─ NO → ❌ Reject (DO NOT CHECK PRODUCT/CATEGORY)
│  └─ NO → Continue
│
├─ Is coupon applies_to === "PRODUCT"?
│  ├─ YES → FLEXIBLE PRODUCT VALIDATION
│  │   ├─ Are variant restrictions defined?
│  │   │  ├─ YES → Check if item.variant_id in allowed_variants
│  │   │  │    ├─ YES → ✅ Apply discount
│  │   │  │    └─ NO → ❌ Reject
│  │   │  └─ NO → Are product restrictions defined?
│  │   │       ├─ YES → Check if item.product_id in allowed_products
│  │   │       │    ├─ YES → ✅ Apply discount
│  │   │       │    └─ NO → ❌ Reject
│  │   │       └─ NO → ✅ Apply to ALL products (global product coupon)
│  └─ NO → Continue
│
├─ Is coupon applies_to === "CATEGORY"?
│  ├─ YES → FLEXIBLE CATEGORY VALIDATION
│  │   ├─ Are category restrictions defined?
│  │   │  ├─ YES → Check if item.category_id in allowed_categories
│  │   │  │    ├─ YES → ✅ Apply discount
│  │   │  │    └─ NO → ❌ Reject
│  │   │  └─ NO → ✅ Apply to ALL categories (global category coupon)
│  └─ NO → ❌ Reject (invalid applies_to value)
│
└─ Calculate Discount & Return Result

`;

// ============================================
// COUPON TYPE CHEAT SHEET
// ============================================

const COUPON_TYPES = {
    ORDER: {
        applies_to: 'order',
        restrictions: 'None - applies to entire order',
        fallback: 'Always applies',
        variant_check: 'NOT needed',
        product_check: 'NOT needed',
        example: 'Flat ₹500 off on any order',
    },
    VARIANT_STRICT: {
        applies_to: 'variant',
        restrictions: 'Exact variant_ids must match',
        fallback: 'NONE - Strict validation only',
        variant_check: 'Required - must match exactly',
        product_check: 'NOT done (strict isolation)',
        example: 'Flat ₹100 off on Size M variant only',
    },
    PRODUCT_FLEXIBLE: {
        applies_to: 'product',
        restrictions: 'Product IDs (or variants if defined)',
        fallback: 'Yes - to all products if no restrictions',
        variant_check: 'First if variant restrictions exist',
        product_check: 'Then if product restrictions exist',
        example: 'Flat ₹200 off on Product A (all variants)',
    },
    CATEGORY_FLEXIBLE: {
        applies_to: 'category',
        restrictions: 'Category IDs',
        fallback: 'Yes - to all categories if no restrictions',
        variant_check: 'Not needed (checked via category)',
        product_check: 'Not directly - via category',
        example: '10% off on all Electronics category',
    },
};

// ============================================
// CODE SNIPPETS FOR IMPLEMENTATION
// ============================================

// ✅ CORRECT: Variant-level validation (strict)
const validateVariantCoupon = (coupon, item, allowedVariantIds) => {
    if (coupon.applies_to !== 'variant') return null;

    // Must have variant mappings
    if (allowedVariantIds.length === 0) {
        console.warn('Configuration error: Variant coupon with no variants');
        return false;
    }

    // Check exact match - NO fallback
    return allowedVariantIds.includes(Number(item.variant_id));
};

// ✅ CORRECT: Product-level validation (flexible)
const validateProductCoupon = (coupon, item, allowedVariantIds, allowedProductIds) => {
    if (coupon.applies_to !== 'product') return null;

    // Check variant restrictions first (if any)
    if (allowedVariantIds.length > 0) {
        return allowedVariantIds.includes(Number(item.variant_id));
    }

    // Then check product restrictions (if any)
    if (allowedProductIds.length > 0) {
        return allowedProductIds.includes(Number(item.product_id));
    }

    // No restrictions = apply to all
    return true;
};

// ✅ CORRECT: Complete validation logic
const validateCouponApplicability = (coupon, item) => {
    const allowedVariantIds = coupon.variants?.map(v => Number(v.variant_id)) || [];
    const allowedProductIds = coupon.products?.map(p => Number(p.product_id)) || [];
    const allowedCategoryIds = coupon.categories?.map(c => Number(c.category_id)) || [];

    const appliesTo = coupon.applies_to?.toLowerCase();
    const itemVariantId = Number(item.variant_id);
    const itemProductId = Number(item.product_id);
    const itemCategoryId = Number(item.category_id);

    // Variant-level: STRICT
    if (appliesTo === 'variant') {
        if (allowedVariantIds.length === 0) {
            throw new Error('Variant coupon has no variants defined');
        }
        return allowedVariantIds.includes(itemVariantId);
    }

    // Product-level: FLEXIBLE
    if (appliesTo === 'product') {
        if (allowedVariantIds.length > 0) {
            return allowedVariantIds.includes(itemVariantId);
        }
        if (allowedProductIds.length > 0) {
            return allowedProductIds.includes(itemProductId);
        }
        return true; // Global product coupon
    }

    // Category-level: FLEXIBLE
    if (appliesTo === 'category') {
        if (allowedCategoryIds.length > 0) {
            return allowedCategoryIds.includes(itemCategoryId);
        }
        return true; // Global category coupon
    }

    // Order-level: ALWAYS
    if (appliesTo === 'order') {
        return true;
    }

    return false;
};

// ============================================
// COMMON MISTAKES TO AVOID
// ============================================

const MISTAKES_TO_AVOID = {
    MISTAKE_1: {
        wrong: `// ❌ WRONG: Allows product check for variant coupons
if (coupon.applies_to === 'variant') {
  eligible = isVariantEligible || isProductEligible; // 🔴 NO fallback!
}`,
        correct: `// ✅ CORRECT: Strict variant-only
if (coupon.applies_to === 'variant') {
  eligible = isVariantEligible; // 🟢 Variant only, no fallback
}`,
    },
    MISTAKE_2: {
        wrong: `// ❌ WRONG: Converting to boolean loses information
const eligible = Boolean(variantList.some(...));`,
        correct: `// ✅ CORRECT: Use explicit type conversion
const itemVariantId = Number(item.variant_id);
const eligible = allowedVariantIds.includes(itemVariantId);`,
    },
    MISTAKE_3: {
        wrong: `// ❌ WRONG: Loose equality with mixed types
if (v.variant_id === item.variant_id) { // May fail if types differ
}`,
        correct: `// ✅ CORRECT: Explicit number conversion
if (Number(v.variant_id) === Number(item.variant_id)) {
}`,
    },
    MISTAKE_4: {
        wrong: `// ❌ WRONG: Generic fallback for all coupon types
if (!hasMappings && appliesTo !== "order") eligible = true;`,
        correct: `// ✅ CORRECT: Type-specific validation
if (appliesTo === 'variant' && allowedVariantIds.length === 0) {
  eligible = false; // Config error
}`,
    },
};

// ============================================
// DEBUGGING CHECKLIST
// ============================================

const DEBUGGING_CHECKLIST = `
When debugging variant coupon issues, check:

□ Database
  ├─ coupon.applies_to = 'variant'? 
  ├─ coupon_variants table has entries for this coupon?
  └─ variant_id values are correct (no typos)?

□ Cart Items
  ├─ item.variant_id is populated?
  ├─ item.variant_id matches database value?
  └─ item.variant_id is a number or string properly converted?

□ Validation Logic
  ├─ allowedVariantIds extracted correctly?
  ├─ allowedVariantIds includes Number conversion?
  ├─ No fallback to product/category for variant coupons?
  └─ Error message is variant-specific?

□ API Response
  ├─ success: false when variant doesn't match?
  ├─ Message says "not applicable to this product variant"?
  ├─ Eligible_items is empty or only has matching variants?
  └─ No discount applied to non-matching variants?

□ Logs
  ├─ [Coupon Validation] logs show correct variant IDs?
  ├─ allowedVariantIds logged correctly?
  ├─ cartVariantIds logged correctly?
  ├─ matchedVariantIds shows correct matches?
  └─ Any ❌ logs indicate rejection reason?
`;

// ============================================
// TESTING TEMPLATE
// ============================================

const TEST_TEMPLATE = `
describe('Variant Coupon Validation', () => {
  // Test structure for new variant coupon tests
  
  it('should apply coupon to exact matching variant', () => {
    // Arrange
    const coupon = { applies_to: 'variant', id: 1 };
    const allowedVariantIds = [10];
    const cartItem = { variant_id: 10 };
    
    // Act
    const eligible = allowedVariantIds.includes(cartItem.variant_id);
    
    // Assert
    assert.strictEqual(eligible, true);
  });

  it('should reject coupon for different variant of same product', () => {
    // Arrange
    const coupon = { applies_to: 'variant', id: 1 };
    const allowedVariantIds = [10];
    const cartItem = { variant_id: 11 }; // ← Different variant
    
    // Act
    const eligible = allowedVariantIds.includes(cartItem.variant_id);
    
    // Assert
    assert.strictEqual(eligible, false);
  });
});
`;

// ============================================
// PRODUCTION ROLLOUT CHECKLIST
// ============================================

const ROLLOUT_CHECKLIST = `
Before deploying to production:

TESTING
□ All 10 unit tests pass
□ Manual API testing with test coupons
□ Staging environment validated
□ Edge cases tested (mixed cart, config error, etc.)

DATABASE
□ Backup production database
□ Verify all variant-level coupons have variants mapped
□ Check for any orphaned coupon_variants entries
□ Document any existing issues with coupons

CODE REVIEW
□ Code changes reviewed by team
□ No breaking changes for other coupon types
□ Backward compatibility verified
□ Error messages are user-friendly

MONITORING
□ Set up alerts for variant-mismatch rejections
□ Create dashboard for coupon metrics
□ Plan for rollback if issues occur

COMMUNICATION
□ Notify support team of expected rejection messages
□ Update internal documentation
□ Document migration steps if needed

DEPLOYMENT
□ Deploy during low-traffic window
□ Monitor error rates for 24 hours
□ Check if variant coupon rejection rate is expected
□ Verify discount calculations are correct

POST-DEPLOYMENT
□ Audit log for variant coupon rejections
□ Confirm no revenue impact
□ Update API documentation
□ Schedule post-launch review
`;

module.exports = {
    VALIDATION_DECISION_TREE,
    COUPON_TYPES,
    MISTAKES_TO_AVOID,
    DEBUGGING_CHECKLIST,
    TEST_TEMPLATE,
    ROLLOUT_CHECKLIST,
    validateVariantCoupon,
    validateProductCoupon,
    validateCouponApplicability,
};
