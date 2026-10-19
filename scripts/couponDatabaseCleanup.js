/**
 * DATABASE CLEANUP & VALIDATION SCRIPT
 * 
 * Use this script to:
 * 1. Identify problematic coupon configurations
 * 2. Validate variant-level coupon integrity
 * 3. Generate reports and recommendations
 * 4. Fix common issues
 * 
 * Usage: node scripts/couponDatabaseCleanup.js
 */

const pool = require('../config/db');

// ============================================
// VALIDATION & CLEANUP FUNCTIONS
// ============================================

/**
 * Find all variant-level coupons with no variants assigned (configuration error)
 */
async function findVariantCouponsWithNoVariants() {
    console.log('\n📋 Checking: Variant-level coupons with no variants assigned...\n');

    const query = `
    SELECT c.id, c.code, c.applies_to, c.is_active,
           COUNT(cv.variant_id) as variant_count
    FROM coupons c
    LEFT JOIN coupon_variants cv ON c.id = cv.coupon_id
    WHERE c.applies_to = 'variant'
    GROUP BY c.id
    HAVING COUNT(cv.variant_id) = 0
    ORDER BY c.created_at DESC;
  `;

    try {
        const [results] = await pool.query(query);

        if (results.length === 0) {
            console.log('✅ No issues found. All variant-level coupons have variants assigned.\n');
            return { count: 0, data: [] };
        }

        console.log(`⚠️ Found ${results.length} variant-level coupons with NO variants assigned:\n`);

        results.forEach((coupon, idx) => {
            console.log(`${idx + 1}. Coupon ID: ${coupon.id}`);
            console.log(`   Code: ${coupon.code}`);
            console.log(`   Active: ${coupon.is_active ? 'Yes' : 'No'}`);
            console.log(`   Variants assigned: ${coupon.variant_count}`);
            console.log('   ⚠️ ACTION: This coupon should either be:');
            console.log('      - Changed to applies_to: "product" if it should apply to all variants');
            console.log('      - Have variants assigned if it should be variant-specific\n');
        });

        return { count: results.length, data: results };
    } catch (err) {
        console.error('❌ Error:', err.message);
        return { count: 0, data: [], error: err };
    }
}

/**
 * Find all variant-level coupons and verify their variants are valid
 */
async function validateVariantCouponIntegrity() {
    console.log('\n📋 Validating: Variant-level coupon integrity...\n');

    const query = `
    SELECT c.id, c.code, COUNT(DISTINCT cv.variant_id) as variant_count,
           GROUP_CONCAT(cv.variant_id) as variant_ids
    FROM coupons c
    JOIN coupon_variants cv ON c.id = cv.coupon_id
    WHERE c.applies_to = 'variant'
    GROUP BY c.id
    ORDER BY c.created_at DESC;
  `;

    try {
        const [results] = await pool.query(query);

        if (results.length === 0) {
            console.log('ℹ️ No variant-level coupons found.\n');
            return { count: 0, data: [] };
        }

        console.log(`✅ Found ${results.length} variant-level coupons:\n`);

        const validationResults = [];

        for (const coupon of results) {
            console.log(`Coupon ID: ${coupon.id}, Code: ${coupon.code}`);
            console.log(`  Assigned to ${coupon.variant_count} variant(s): [${coupon.variant_ids}]`);

            // Check if variants exist in products_variants table
            const variantIds = coupon.variant_ids.split(',').map(v => Number(v.trim()));
            const [variantRowsCheck] = await pool.query(
                `SELECT COUNT(*) as existing_count FROM products_variants WHERE id IN (?)`,
                [variantIds]
            );

            if (variantRowsCheck[0].existing_count === variantIds.length) {
                console.log('  ✅ All variants exist in database\n');
                validationResults.push({ couponId: coupon.id, status: 'valid' });
            } else {
                console.log('  ⚠️ Some variants do NOT exist in database!\n');
                validationResults.push({ couponId: coupon.id, status: 'invalid' });
            }
        }

        return { count: results.length, data: results, validation: validationResults };
    } catch (err) {
        console.error('❌ Error:', err.message);
        return { count: 0, data: [], error: err };
    }
}

/**
 * Find orphaned coupon_variants entries (variants assigned to non-existent coupons)
 */
async function findOrphanedVariantMappings() {
    console.log('\n📋 Checking: Orphaned coupon-variant mappings...\n');

    const query = `
    SELECT cv.coupon_id, cv.variant_id, COUNT(*) as mapping_count
    FROM coupon_variants cv
    LEFT JOIN coupons c ON cv.coupon_id = c.id
    WHERE c.id IS NULL
    GROUP BY cv.coupon_id, cv.variant_id;
  `;

    try {
        const [results] = await pool.query(query);

        if (results.length === 0) {
            console.log('✅ No orphaned mappings found.\n');
            return { count: 0, data: [] };
        }

        console.log(`⚠️ Found ${results.length} orphaned coupon-variant mappings:\n`);

        results.forEach((mapping) => {
            console.log(`Orphaned mapping: Coupon ID ${mapping.coupon_id} → Variant ID ${mapping.variant_id}`);
        });

        console.log('\n💡 These entries can be safely deleted:\n');
        console.log(`DELETE FROM coupon_variants WHERE coupon_id NOT IN (SELECT id FROM coupons);\n`);

        return { count: results.length, data: results };
    } catch (err) {
        console.error('❌ Error:', err.message);
        return { count: 0, data: [], error: err };
    }
}

/**
 * Generate comprehensive coupon audit report
 */
async function generateAuditReport() {
    console.log('\n📊 COUPON AUDIT REPORT\n');
    console.log('='.repeat(60) + '\n');

    try {
        // Total coupons by type
        const [typeCounts] = await pool.query(`
      SELECT applies_to, COUNT(*) as count, 
             SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count
      FROM coupons
      GROUP BY applies_to;
    `);

        console.log('📈 COUPONS BY TYPE:\n');
        typeCounts.forEach(row => {
            console.log(`${row.applies_to.toUpperCase()}: ${row.count} total (${row.active_count} active)`);
        });

        // Variant-specific stats
        const [[variantStats]] = await pool.query(`
      SELECT 
        COUNT(DISTINCT c.id) as total_variant_coupons,
        COUNT(DISTINCT cv.coupon_id) as coupons_with_variants,
        COUNT(DISTINCT cv.variant_id) as total_variants_assigned,
        ROUND(AVG(variant_count), 2) as avg_variants_per_coupon
      FROM coupons c
      LEFT JOIN (
        SELECT coupon_id, COUNT(*) as variant_count
        FROM coupon_variants
        GROUP BY coupon_id
      ) cv ON c.id = cv.coupon_id
      WHERE c.applies_to = 'variant';
    `);

        console.log('\n🎯 VARIANT-LEVEL COUPON STATS:\n');
        console.log(`Total variant-level coupons: ${variantStats.total_variant_coupons}`);
        console.log(`Coupons with variants assigned: ${variantStats.coupons_with_variants}`);
        console.log(`Total variants assigned: ${variantStats.total_variants_assigned}`);
        console.log(`Avg variants per coupon: ${variantStats.avg_variants_per_coupon}`);

        // Inactive coupons
        const [[inactiveStats]] = await pool.query(`
      SELECT COUNT(*) as inactive_count FROM coupons WHERE is_active = 0;
    `);

        console.log('\n📵 INACTIVE COUPONS:\n');
        console.log(`Deactivated coupons: ${inactiveStats.inactive_count}`);

        // Expired coupons
        const [[expiredStats]] = await pool.query(`
      SELECT COUNT(*) as expired_count FROM coupons WHERE expiry_date < NOW();
    `);

        console.log('\n⏰ EXPIRED COUPONS:\n');
        console.log(`Expired coupons: ${expiredStats.expired_count}`);

        console.log('\n' + '='.repeat(60) + '\n');
    } catch (err) {
        console.error('❌ Error generating report:', err.message);
    }
}

/**
 * Clean up orphaned variant mappings
 */
async function cleanupOrphanedMappings() {
    console.log('\n🧹 Cleaning up orphaned coupon-variant mappings...\n');

    try {
        const [results] = await pool.query(
            `DELETE FROM coupon_variants WHERE coupon_id NOT IN (SELECT id FROM coupons)`
        );

        console.log(`✅ Deleted ${results.affectedRows} orphaned entries\n`);
        return { success: true, affectedRows: results.affectedRows };
    } catch (err) {
        console.error('❌ Error:', err.message);
        return { success: false, error: err };
    }
}

/**
 * Get recommendations based on validation results
 */
function generateRecommendations(validationResults) {
    console.log('\n💡 RECOMMENDATIONS:\n');

    const issues = {
        configError: [],
        invalidVariants: [],
        orphaned: [],
    };

    // Collect issues...
    if (validationResults.configError) {
        issues.configError = validationResults.configError;
    }

    if (issues.configError.length > 0) {
        console.log(`1. FIX ${issues.configError.length} CONFIGURATION ERRORS:`);
        console.log('   For variant-level coupons with no variants:');
        console.log('   - Option A: Change applies_to to "product"');
        console.log('   - Option B: Assign specific variants\n');
    }

    if (issues.invalidVariants.length > 0) {
        console.log(`2. INVESTIGATE ${issues.invalidVariants.length} INVALID VARIANTS:`);
        console.log('   These coupons reference non-existent variants:');
        console.log('   - Contact support about their intent');
        console.log('   - Update or remove invalid assignments\n');
    }

    if (issues.orphaned.length > 0) {
        console.log(`3. REMOVE ${issues.orphaned.length} ORPHANED MAPPINGS:`);
        console.log('   Safe to delete - they reference deleted coupons\n');
    }

    console.log('4. TESTING:');
    console.log('   Run the variant validation test suite:');
    console.log('   npm test tests/couponVariantValidation.test.js\n');

    console.log('5. MONITORING:');
    console.log('   Watch for these patterns in logs:');
    console.log('   - "Coupon is not applicable to this product variant"');
    console.log('   - "Variant-level coupon has no variants mapped"\n');
}

// ============================================
// MAIN EXECUTION
// ============================================

async function runFullAudit() {
    console.log('\n' + '='.repeat(60));
    console.log('   COUPON DATABASE VALIDATION & CLEANUP');
    console.log('='.repeat(60));

    try {
        // Run all checks
        const configErrorCheck = await findVariantCouponsWithNoVariants();
        const integrityCheck = await validateVariantCouponIntegrity();
        const orphanedCheck = await findOrphanedVariantMappings();

        // Generate report
        await generateAuditReport();

        // Generate recommendations
        generateRecommendations({
            configError: configErrorCheck.data,
            invalidVariants: integrityCheck.validation?.filter(v => v.status === 'invalid') || [],
            orphaned: orphanedCheck.data,
        });

        console.log('\n' + '='.repeat(60));
        console.log('   AUDIT COMPLETE');
        console.log('='.repeat(60) + '\n');

        // Return summary
        return {
            configErrors: configErrorCheck.count,
            orphanedMappings: orphanedCheck.count,
            timestamp: new Date().toISOString(),
        };
    } catch (err) {
        console.error('\n❌ AUDIT FAILED:', err.message);
        process.exit(1);
    }
}

// ============================================
// EXPORT & RUN
// ============================================

module.exports = {
    findVariantCouponsWithNoVariants,
    validateVariantCouponIntegrity,
    findOrphanedVariantMappings,
    generateAuditReport,
    cleanupOrphanedMappings,
    generateRecommendations,
    runFullAudit,
};

// Run if executed directly
if (require.main === module) {
    runFullAudit().then(() => {
        process.exit(0);
    }).catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}
