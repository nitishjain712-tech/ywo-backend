const logger = require("../utils/logger");
const pool = require("../config/db");
const Order = require("../models/orderModel");
const OrderItem = require("../models/orderItemModel");
const Payment = require("../models/paymentModel");
const phonepeService = require("../services/phonepeService");
const { calculateShipping } = require('./shippingController');
const couponModel = require("../models/couponModel");
const { releaseStockForOrder, revertCouponsForOrder, revertCouponsForCancelledItems, recordCouponUsageForOrder } = require("../utils/orderHelpers");
const ExtraDeliveryCharge = require("../models/extraDeliveryChargeModel");
const CodSettings = require("../models/codSettingsModel");
const orderEmailService = require("../services/orderEmailService");
const adminOrderEmailService = require("../services/adminOrderEmailService");
const { fireAndForget } = require("../utils/fireAndForget");
const shipmentEmailService = require("../services/shipmentEmailService");
const deliveryEmailService = require("../services/deliveryEmailService");

// Razorpay
const { getGateway } = require("../services/paymentGatewayFactory");


const orderController = {

  previewOrder: async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const user_id = req.user?.id;
      if (!user_id) return res.status(401).json({ message: "Unauthorized" });

      const { address_id, payment_method, items = [], order_coupon_id = null } = req.body;
      if (!address_id) return res.status(400).json({ message: "address_id required" });
      if (!items.length) return res.status(400).json({ message: "No items provided" });

      // 1️⃣ Fetch user and address
      const [[user]] = await conn.query(`SELECT id, name, email, phone_number, gst_number FROM users WHERE id = ?`, [user_id]);
      if (!user) return res.status(404).json({ message: "User not found" });

      const [[address]] = await conn.query(
        `SELECT * FROM user_addresses WHERE id = ? AND user_id = ?`,
        [address_id, user_id]
      );
      if (!address) return res.status(404).json({ message: "Address not found" });

      // 2️⃣ Merge duplicate variants
      const mergedItems = [];
      for (const it of items) {
        const existing = mergedItems.find(m => Number(m.variant_id) === Number(it.variant_id));
        if (existing) existing.quantity += Number(it.quantity);
        else mergedItems.push({ ...it, quantity: Number(it.quantity) });
      }

      // 3️⃣ Fetch product + variant data
      const variantIds = mergedItems.map(it => it.variant_id);
      const [productData] = await conn.query(`
      SELECT p.id AS product_id, p.category_id, p.is_free_shipping AS product_free_shipping,
             v.id AS variant_id, v.price, v.stock, v.weight, v.length, v.width, v.height,
             v.is_free_shipping AS variant_free_shipping
      FROM products p
      JOIN product_variants v ON p.id = v.product_id
      WHERE v.id IN (?)
    `, [variantIds]);

      if (!productData.length) return res.status(404).json({ message: "No product variants found" });

      // 🟣 Fetch all deals (only if any item has deal_id)
      const dealIds = mergedItems.map(it => it.deal_id).filter(Boolean);
      let dealList = [];
      if (dealIds.length) {
        const [rows] = await conn.query(
          `SELECT id, product_id, deal_price, start_date, end_date, is_active 
         FROM deal_of_day
         WHERE id IN (?) AND is_active = 1`,
          [dealIds]
        );
        dealList = rows;
      }

      // 4️⃣ Collect coupons
      const couponIds = mergedItems.map(it => it.coupon_id).filter(Boolean);
      if (order_coupon_id) couponIds.push(order_coupon_id);
      const uniqueCouponIds = [...new Set(couponIds)];

      const [couponList] = uniqueCouponIds.length
        ? await conn.query(`SELECT * FROM coupons WHERE id IN (?) AND is_active = 1`, [uniqueCouponIds])
        : [[]];

      const [couponVariants] = uniqueCouponIds.length
        ? await conn.query(`SELECT * FROM coupon_variants WHERE coupon_id IN (?)`, [uniqueCouponIds])
        : [[]];

      const [couponProducts] = uniqueCouponIds.length
        ? await conn.query(`SELECT * FROM coupon_products WHERE coupon_id IN (?)`, [uniqueCouponIds])
        : [[]];

      const [couponCategories] = uniqueCouponIds.length
        ? await conn.query(`SELECT * FROM coupon_categories WHERE coupon_id IN (?)`, [uniqueCouponIds])
        : [[]];

      // 5️⃣ User usage tracking
      const [orderUsageRows] = uniqueCouponIds.length
        ? await conn.query(
          `SELECT order_coupon_id AS coupon_id, COUNT(*) AS used 
           FROM orders 
           WHERE order_coupon_id IN (?) AND user_id = ? AND order_status != 'CANCELLED'
           GROUP BY order_coupon_id`,
          [uniqueCouponIds, user_id]
        )
        : [[]];

      const [itemUsageRows] = uniqueCouponIds.length
        ? await conn.query(
          `SELECT oi.coupon_id, COUNT(*) AS used 
           FROM order_items oi 
           JOIN orders o ON oi.order_id = o.order_id 
           WHERE oi.coupon_id IN (?) AND o.user_id = ? AND oi.item_status != 'CANCELLED' AND o.order_status != 'CANCELLED'
           GROUP BY oi.coupon_id`,
          [uniqueCouponIds, user_id]
        )
        : [[]];

      const usageCounts = {};
      uniqueCouponIds.forEach(id => (usageCounts[id] = 0));

      orderUsageRows.forEach(u => {
        if (u.coupon_id) usageCounts[u.coupon_id] += u.used;
      });

      itemUsageRows.forEach(u => {
        if (u.coupon_id) usageCounts[u.coupon_id] += u.used;
      });

      // 6️⃣ Calculate item-level details
      const itemsDetailed = [];
      let subtotal = 0;
      let total_items_discount = 0;
      const round = n => Number(n.toFixed(2));
      const now = new Date();

      for (const it of mergedItems) {
        const variant = productData.find(v => Number(v.variant_id) === Number(it.variant_id));
        if (!variant) continue;

        const quantity = Number(it.quantity) || 1;

        // 🟢 Apply deal if valid
        let is_deal_applied = false;
        let deal_price = Number(variant.price);

        if (it.deal_id) {
          const deal = dealList.find(d => Number(d.id) === Number(it.deal_id));
          if (deal) {
            const start = new Date(deal.start_date);
            const end = new Date(deal.end_date);
            const isValid =
              deal.is_active &&
              now >= start &&
              now <= end &&
              Number(deal.product_id) === Number(it.product_id);

            if (isValid) {
              deal_price = Number(deal.deal_price);
              is_deal_applied = true;
            }
          }
        }

        const price = deal_price;
        const total_price = price * quantity;

        if (variant.stock < quantity) {
          return res.status(400).json({
            message: `Insufficient stock for variant ${variant.variant_id}. Available: ${variant.stock}`
          });
        }

        let per_item_discount = 0;
        let per_item_coupon_code = null;

        // 6️⃣.1 Check if item has coupon
        if (it.coupon_id) {
          const coupon = couponList.find(c => Number(c.id) === Number(it.coupon_id));
          if (coupon) {
            const start = coupon.start_date ? new Date(coupon.start_date) : null;
            const end = coupon.expiry_date ? new Date(coupon.expiry_date) : null;
            const activeDate = (!start || now >= start) && (!end || now <= end);
            const meetsMinAmount = !coupon.min_order_amount || total_price >= Number(coupon.min_order_amount);
            const meetsMinQty = !coupon.min_quantity || quantity >= Number(coupon.min_quantity);
            const userUsage = usageCounts[coupon.id] || 0;

            const isVariantEligible = couponVariants.some(cv => Number(cv.coupon_id) === Number(coupon.id) && Number(cv.variant_id) === Number(variant.variant_id));
            const isProductEligible = couponProducts.some(cp => Number(cp.coupon_id) === Number(coupon.id) && Number(cp.product_id) === Number(variant.product_id));
            const isCategoryEligible = couponCategories.some(cc => Number(cc.coupon_id) === Number(coupon.id) && Number(cc.category_id) === Number(variant.category_id));

            const eligible = (coupon.applies_to === "variant" && isVariantEligible) ||
              (coupon.applies_to === "product" && isProductEligible) ||
              (coupon.applies_to === "category" && isCategoryEligible);

            if (
              activeDate &&
              meetsMinAmount &&
              meetsMinQty &&
              userUsage < Number(coupon.per_user_limit || Infinity) &&
              eligible
            ) {
              per_item_discount =
                coupon.discount_type === "percentage"
                  ? (total_price * Number(coupon.discount_value)) / 100
                  : Number(coupon.discount_value);
              per_item_discount = Math.min(per_item_discount, total_price);
              per_item_coupon_code = coupon.code;
            }
          }
        }

        per_item_discount = round(per_item_discount);
        total_items_discount += per_item_discount;

        // Shipping calculation placeholder
        let shipping_price = 0;
        let shipping_message = (variant.product_free_shipping || variant.variant_free_shipping)
          ? "Free Shipping Available"
          : "Shipping to be calculated";

        itemsDetailed.push({
          product_id: variant.product_id,
          variant_id: variant.variant_id,
          quantity,
          price,
          per_item_coupon_id: it.coupon_id || null,
          per_item_coupon_code,
          per_item_discount,
          sub_total: round(total_price - per_item_discount),
          shipping_price,
          shipping_message,
          deal_id: it.deal_id || null,
          is_deal_applied
        });

        subtotal += total_price - per_item_discount;
      }

      // 🚫 COD restriction for high-value orders (Admin-controlled)
      if (payment_method === "COD") {
        try {
          const codSetting = await CodSettings.getActive();

          if (
            codSetting &&
            Number(subtotal) > Number(codSetting.max_cod_amount)
          ) {
            return res.status(400).json({
              message: `Cash on Delivery is not available for orders above ₹${codSetting.max_cod_amount}. Please choose online payment.`,
            });
          }
        } catch (err) {
          logger.warn("COD settings fetch failed:", err.message);
          // Optional: fail-safe → allow COD if config fetch fails
        }
      }


      // 7️⃣ Prevent mixing order & item level coupons
      const hasItemCoupons = itemsDetailed.some(it => it.per_item_coupon_id);
      if (hasItemCoupons && order_coupon_id) {
        return res.status(400).json({
          message: "Cannot combine item-level and order-level coupons. Please remove one."
        });
      }

      // 🔹 Extra delivery charge variables
      let extra_delivery_charge = 0;
      let extra_delivery_charge_type = null;
      let extra_delivery_charge_rate = 0;

      // 8️⃣ Calculate shipping via Shiprocket
      let total_shipping_price = 0;

      try {
        const cartItemsForShipping = itemsDetailed
          .filter(it => it.shipping_message === "Shipping to be calculated")
          .map(it => {
            const v = productData.find(p => p.variant_id === it.variant_id);
            return {
              variant_id: v.variant_id,
              product_id: v.product_id,
              weight: v.weight,
              length: v.length,
              breadth: v.width,
              height: v.height,
              declared_value: it.price,
              quantity: it.quantity
            };
          });

        if (cartItemsForShipping.length) {
          const codFlag = payment_method === "COD" ? 1 : 0;

          const shippingResp = await calculateShipping(
            { body: { pickup_postcode: process.env.PICKUP_PINCODE || "452009", delivery_postcode: address.pincode, cod: codFlag, cartItems: cartItemsForShipping } },
            { status: () => ({ json: d => d }) }
          );

          if (shippingResp?.perItemShipping?.length) {
            for (const item of itemsDetailed) {
              const shipItem = shippingResp.perItemShipping.find(
                s => s.variant_id === item.variant_id
              );
              if (shipItem) {
                item.shipping_price = Number(shipItem.item_shipping_cost || 0);
                item.shipping_message = "Shipping Calculated Via Shiprocket";
              }
            }
          }

          total_shipping_price = Number(shippingResp.total_shipping_price || 0);

          if (total_shipping_price <= 0) {
            logger.info("Shipping Info:", shippingResp);
            return res.status(400).json({ message: `${shippingResp.message}. Try a different payment method or contact to support: 7314245858 / 9522582422.` , details: shippingResp, shipping_error: shippingResp.shipping_error, shipping_message: shippingResp.shipping_message });
          }

          // 🔹 Apply Extra Delivery Charge
          try {
            const extraCharge = await ExtraDeliveryCharge.getActive();

            if (extraCharge && total_shipping_price > 0) {
              extra_delivery_charge_type = extraCharge.charge_type;
              extra_delivery_charge_rate = Number(extraCharge.charge_value);

              if (extraCharge.charge_type === "percentage") {
                extra_delivery_charge =
                  (total_shipping_price * extra_delivery_charge_rate) / 100;
              }

              if (extraCharge.charge_type === "fixed") {
                extra_delivery_charge = extra_delivery_charge_rate;
              }

              total_shipping_price = Number(
                (total_shipping_price + extra_delivery_charge).toFixed(2)
              );
            }
          } catch (err) {
            logger.warn("Extra delivery charge fetch failed:", err.message);
          }

          // 🔹 Distribute extra delivery charge across items
          if (extra_delivery_charge > 0) {
            const shippableItems = itemsDetailed.filter(
              it => it.shipping_message === "Shipping Calculated Via Shiprocket"
            );

            const baseItemShippingTotal = shippableItems.reduce(
              (sum, it) => sum + Number(it.shipping_price || 0),
              0
            );

            if (baseItemShippingTotal > 0) {
              let distributedSum = 0;

              shippableItems.forEach((item, index) => {
                if (index === shippableItems.length - 1) {
                  // last item rounding adjustment
                  item.shipping_price = Number(
                    (
                      item.shipping_price +
                      (extra_delivery_charge - distributedSum)
                    ).toFixed(2)
                  );
                } else {
                  const ratio = item.shipping_price / baseItemShippingTotal;
                  const extraShare = Number(
                    (extra_delivery_charge * ratio).toFixed(2)
                  );

                  item.shipping_price = Number(
                    (item.shipping_price + extraShare).toFixed(2)
                  );

                  distributedSum += extraShare;
                }
              });
            }
          }

        }
      } catch (err) {
        logger.error("Shiprocket API failed:", err.message);
        return res.status(400).json({ message: "Shipping is not available", error: err.message });
      }


      // 9️⃣ Handle order-level coupon
      let total_order_discount = 0;
      let order_coupon_code = null;

      if (!hasItemCoupons && order_coupon_id) {
        const coupon = couponList.find(c => Number(c.id) === Number(order_coupon_id));
        if (coupon) {
          const start = coupon.start_date ? new Date(coupon.start_date) : null;
          const end = coupon.expiry_date ? new Date(coupon.expiry_date) : null;
          const activeDate = (!start || now >= start) && (!end || now <= end);
          const meetsMinAmount = !coupon.min_order_amount || subtotal >= Number(coupon.min_order_amount);
          const userUsage = usageCounts[coupon.id] || 0;

          if (activeDate && meetsMinAmount && userUsage < Number(coupon.per_user_limit || Infinity)) {
            total_order_discount =
              coupon.discount_type === "percentage"
                ? (subtotal * coupon.discount_value) / 100
                : coupon.discount_value;
            total_order_discount = Math.min(total_order_discount, subtotal);
            order_coupon_code = coupon.code;
          }
        }
      }

      // 9️⃣.5️⃣ Fetch COD and Additional Charges
      let cod_charge = 0;
      let cod_charge_type = null;
      let cod_charge_rate = 0;
      let additional_charge = 0;
      let additional_charge_type = null;
      let additional_charge_rate = 0;

      try {
        const [charges] = await conn.query(
          "SELECT charge_name, amount, charge_type FROM charges WHERE is_active = 1 AND charge_name IN ('COD', 'ADDITIONAL')"
        );

        if (charges?.length) {
          for (const ch of charges) {
            const rate = Number(ch.amount);
            if (ch.charge_name === "COD") {
              if (payment_method === "COD") {
                cod_charge_rate = rate;
                cod_charge_type = ch.charge_type;
                cod_charge = ch.charge_type === "PERCENTAGE" ? (subtotal * rate) / 100 : rate;
              }
            }
            if (ch.charge_name === "ADDITIONAL") {
              additional_charge_rate = rate;
              additional_charge_type = ch.charge_type;
              additional_charge = ch.charge_type === "PERCENTAGE" ? (subtotal * rate) / 100 : rate;
            }
          }
        }
      } catch (err) {
        logger.warn("Charge fetch failed:", err.message);
      }

      // 🔟 Final total
      const total_amount = round(
        subtotal - total_order_discount + total_shipping_price + cod_charge + additional_charge
      );

      const shipping_details = {
        shipping_name: user.name,
        shipping_phone: user.phone_number,
        shipping_email: user.email,
        shipping_street: [address.address_line1, address.address_line2].filter(Boolean).join(", "),
        shipping_city: address.city,
        shipping_state: address.state,
        shipping_zip: address.pincode,
        shipping_country: address.country,
        gst_number: user.gst_number || null
      };

      // ✅ Final response
      return res.json({
        message: "Order Preview",
        address_id,
        payment_method,
        shipping_details,
        items: itemsDetailed,
        subtotal: round(subtotal),
        total_items_discount: round(total_items_discount),
        total_order_discount: round(total_order_discount),
        order_coupon_code,
        order_coupon_id: order_coupon_id || null,
        total_shipping_price: round(total_shipping_price),
        extra_delivery_charge: round(extra_delivery_charge),
        extra_delivery_charge_type,
        extra_delivery_charge_rate,
        cod_charge: round(cod_charge),
        cod_charge_type: cod_charge_type || null,
        cod_charge_rate,
        additional_charge: round(additional_charge),
        additional_charge_type: additional_charge_type || null,
        additional_charge_rate,
        total_amount
      });
    } catch (err) {
      logger.error("❌ [Order Preview Error]:", err);
      res.status(500).json({ message: "Error generating preview", error: err.message });
    } finally {
      conn.release();
    }
  },



  // ----------------- Admin Cancel Order -----------------


  placeOrder: async (req, res) => {
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ message: "Unauthorized" });

    const {
      address_id,
      payment_method = "ONLINE",
      shipping_details,
      items = [],
      total_amount,
      total_shipping_price = 0,
      // 🆕 extra delivery charge
      extra_delivery_charge = 0,
      extra_delivery_charge_type = null,
      extra_delivery_charge_rate = 0,
      order_coupon_id = null,
      order_coupon_code = null,
      total_items_discount = 0,
      total_order_discount = 0,
      cod_charge = 0,
      cod_charge_type = null,
      cod_charge_rate = 0,
      additional_charge = 0,
      additional_charge_type = null,
      additional_charge_rate = 0
    } = req.body;

    if (!address_id) return res.status(400).json({ message: "address_id required" });
    if (!items.length) return res.status(400).json({ message: "No items provided" });

    const total_discount_amount =
      total_items_discount > 0
        ? total_items_discount
        : total_order_discount > 0
          ? total_order_discount
          : 0;

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      // 🚫 COD restriction for high-value orders (SECURITY CHECK)
      if (payment_method === "COD") {
        const codSetting = await CodSettings.getActive();

        if (
          codSetting &&
          Number(total_amount) > Number(codSetting.max_cod_amount)
        ) {
          await conn.rollback();
          conn.release();

          return res.status(400).json({
            message: `Cash on Delivery is not available for orders above ₹${codSetting.max_cod_amount}. Please choose online payment.`,
          });
        }
      }

      // 1️⃣ Lock & validate stock
      for (const item of items) {
        const [rows] = await conn.query(
          `SELECT stock FROM product_variants WHERE id = ? FOR UPDATE`,
          [item.variant_id]
        );
        if (!rows.length) throw new Error(`Variant not found: ${item.variant_id}`);
        if (rows[0].stock < item.quantity)
          throw new Error(`Insufficient stock for variant ${item.variant_id}`);
      }

      // 2️⃣ Insert order
      const orderStatus = payment_method === "COD" ? "CONFIRMED" : "PENDING";
      const [orderResult] = await conn.query(
        `INSERT INTO orders (
        user_id, address_id, shipping_name, shipping_phone, shipping_email, shipping_street, shipping_city,
        shipping_state, shipping_zip, shipping_country, gst_number, total_amount, total_discount_amount,
        total_shipping_price, extra_delivery_charge, extra_delivery_charge_type, extra_delivery_charge_rate, order_status, order_coupon_id, order_coupon_code,
        cod_charge, cod_charge_type, cod_charge_rate,
        additional_charge, additional_charge_type, additional_charge_rate,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          user_id,
          address_id,
          shipping_details.shipping_name,
          shipping_details.shipping_phone,
          shipping_details.shipping_email,
          shipping_details.shipping_street,
          shipping_details.shipping_city,
          shipping_details.shipping_state,
          shipping_details.shipping_zip,
          shipping_details.shipping_country,
          shipping_details.gst_number || null,
          total_amount,
          total_discount_amount,
          total_shipping_price,
          // 🆕 extra delivery charge values
          extra_delivery_charge || 0,
          extra_delivery_charge_type || null,
          extra_delivery_charge_rate || 0,
          orderStatus,
          order_coupon_id || null,
          order_coupon_code || null,
          cod_charge || 0,
          cod_charge_type || null,
          cod_charge_rate || 0,
          additional_charge || 0,
          additional_charge_type || null,
          additional_charge_rate || 0
        ]
      );
      const order_id = orderResult.insertId;

      // 🧩 Validate product IDs before inserting items
      const productIds = items.map(it => it.product_id);
      if (!productIds.length) throw new Error("No product IDs found in items payload");

      const [validProducts] = await conn.query(
        `SELECT id FROM products WHERE id IN (?)`,
        [productIds]
      );

      if (validProducts.length !== productIds.length) {
        const validIds = validProducts.map(p => p.id);
        const invalidIds = productIds.filter(id => !validIds.includes(id));
        throw new Error(`Invalid product_id(s): ${invalidIds.join(", ")}`);
      }

      // 3️⃣ Insert order items (🆕 added deal_id and is_deal_applied)
      const insertedOrderItems = [];
      for (const item of items) {
        const [r] = await conn.query(
          `INSERT INTO order_items 
          (order_id, product_id, variant_id, quantity, price, subtotal, per_item_discount, coupon_code,
           shipping_price, shipping_message, coupon_id, item_status, deal_id, is_deal_applied)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            order_id,
            item.product_id,
            item.variant_id,
            item.quantity,
            item.price,
            item.sub_total,
            item.per_item_discount || 0,
            item.per_item_coupon_code || null,
            item.shipping_price || 0,
            item.shipping_message || "",
            item.per_item_coupon_id || null,
            payment_method === "COD" ? "CONFIRMED" : "PENDING",
            item.deal_id || null, // ✅ newly added
            item.is_deal_applied ? 1 : 0 // ✅ newly added (store as tinyint 0/1)
          ]
        );

        insertedOrderItems.push({
          order_item_id: r.insertId,
          variant_id: item.variant_id,
          quantity: item.quantity,
          coupon_id: item.per_item_coupon_id || null
        });
      }

      // 4️⃣ Deduct stock for COD
      if (payment_method === "COD") {
        for (const it of insertedOrderItems) {
          await conn.query(
            `UPDATE product_variants SET stock = stock - ? WHERE id = ?`,
            [it.quantity, it.variant_id]
          );
        }
      }

      // 5️⃣ Create payment record
      const [paymentResult] = await conn.query(
        `INSERT INTO payments (
          order_id, 
          merchant_user_id, 
          amount, 
          payment_method, 
          payment_gateway, 
          status, 
          created_at, 
          updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          order_id,
          user_id,
          total_amount,
          payment_method,
          payment_method === "ONLINE" ? process.env.ACTIVE_PAYMENT_GATEWAY : "COD",
          payment_method === "COD" ? "PENDING" : "PENDING"
        ]
      );

      const payment_id = paymentResult.insertId;

      await conn.commit();
      conn.release();

      if (payment_method?.toUpperCase() === "COD") {
        try {
          // 🔹 Fetch order + user ONCE
          const [rows] = await pool.query(
            `SELECT o.*, u.email, u.name
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE o.order_id = ?`,
            [order_id]
          );

          const orderData = rows[0];
          if (!orderData) return;

          /* -------------------------------
             📧 CUSTOMER – COD ORDER EMAIL
          -------------------------------- */
          if (!orderData.order_notification_sent) {

            const [orderItemsForEmail] = await pool.query(
              `SELECT 
           oi.quantity,
           oi.price,
           oi.subtotal AS sub_total,
           p.name AS product_name,
           pv.variant_name
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         JOIN product_variants pv ON oi.variant_id = pv.id
         WHERE oi.order_id = ?`,
              [order_id]
            );

            fireAndForget(() =>
              orderEmailService.sendOrderEmail({
                eventType: "ORDER_PLACED",
                order: { ...orderData, payment_method: "COD" },
                items: orderItemsForEmail,
                user: {
                  name: orderData.name,
                  email: orderData.email
                }
              })
            );

            await pool.query(
              `UPDATE orders
         SET order_notification_sent = 1
         WHERE order_id = ?`,
              [order_id]
            );

            logger.info("📧 CUSTOMER COD EMAIL SENT:", order_id);
          }

          /* -------------------------------
             📧 ADMIN – NEW COD ORDER EMAIL
          -------------------------------- */
          if (!orderData.admin_notification_sent) {

            const [orderItemsForAdmin] = await pool.query(
              `SELECT 
           oi.quantity,
           p.name AS product_name,
           pv.variant_name
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         JOIN product_variants pv ON oi.variant_id = pv.id
         WHERE oi.order_id = ?`,
              [order_id]
            );

            fireAndForget(() =>
              adminOrderEmailService.sendAdminNewOrderEmail({
                order: {
                  order_id: orderData.order_id,
                  total_amount: orderData.total_amount,
                  payment_method: "COD"
                },
                items: orderItemsForAdmin,
                user: {
                  name: orderData.name,
                  email: orderData.email
                }
              })
            );

            await pool.query(
              `UPDATE orders
         SET admin_notification_sent = 1
         WHERE order_id = ?`,
              [order_id]
            );

            logger.info("📧 ADMIN COD ORDER EMAIL SENT:", order_id);
          }

        } catch (err) {
          logger.error("📧 COD email flow error:", err.message);
        }
      }

      // 🧾 Post-commit coupon usage
      if (payment_method === "COD") {
        try {
          await recordCouponUsageForOrder(order_id);
        } catch (couponErr) {
          logger.error("COD coupon recording error for order", order_id, couponErr);
        }
      }

      // 🟢 ONLINE flow
      // if (payment_method === "ONLINE") {
      //   try {
      //     const phonepe = await phonepeService.initiatePayment(order_id, total_amount);
      //     await pool.query(
      //       `UPDATE payments SET transaction_id = ?, merchant_order_id = ? WHERE payment_id = ?`,
      //       [phonepe.transaction_id, phonepe.merchant_order_id, payment_id]
      //     );

      //     return res.status(201).json({
      //       message: "Order created",
      //       order_id,
      //       paymentUrl: phonepe.redirectUrl,
      //       transactionId: phonepe.transaction_id,
      //       merchantOrderId: phonepe.merchant_order_id
      //     });
      //   } catch (gatewayErr) {
      //     logger.error("Payment gateway initiation failed for order", order_id, gatewayErr);
      //     return res.status(500).json({ message: "Payment initiation failed", error: gatewayErr.message });
      //   }
      // }


      if (payment_method === "ONLINE") {

        const gateway = getGateway();

        const gatewayOrder = await gateway.createOrder(order_id, total_amount);

        if (!gatewayOrder?.id) {
          throw new Error("Gateway order creation failed");
        }

        await pool.query(
          `UPDATE payments 
     SET merchant_order_id = ?, 
         payment_gateway = ?
     WHERE payment_id = ?`,
          [
            gatewayOrder.id || gatewayOrder.merchant_order_id,
            process.env.ACTIVE_PAYMENT_GATEWAY,
            payment_id
          ]
        );

        return res.status(201).json({
          message: "Order created",
          order_id,
          gateway: process.env.ACTIVE_PAYMENT_GATEWAY,
          gatewayOrderId: gatewayOrder.id,
          amount: gatewayOrder.amount,
          key: process.env.RAZORPAY_KEY_ID || null
        });
      }

      // COD success
      return res.status(201).json({ message: "Order created (COD)", order_id });
    } catch (err) {
      try { await conn.rollback(); } catch (e) { }
      try { conn.release(); } catch (e) { }
      logger.error("❌ Place order failed:", err);
      return res.status(500).json({ message: "Error creating order", error: err.message });
    }
  },

  adminCancelOrder: async (req, res) => {
    try {
      let { order_id, order_item_ids } = req.body;

      // Normalize empty or undefined to array
      if (!order_id) {
        return res.status(400).json({
          success: false,
          message: "order_id is required"
        });
      }

      if (!Array.isArray(order_item_ids)) {
        order_item_ids = [];  // Treat undefined as full cancel
      }

      const result = await Order.cancelOrder(order_id, order_item_ids);

      return res.status(200).json({
        success: true,
        ...result
      });

    } catch (err) {
      logger.error("❌ Admin cancel order failed:", err);

      return res.status(500).json({
        success: false,
        message: "Error cancelling order",
        error: err.message,
      });
    }
  },

  adminRecordRefundForReturn: async (req, res) => {
    try {
      const { order_id, refunds = [] } = req.body;

      if (!order_id) {
        return res.status(400).json({ message: "order_id is required" });
      }

      if (!Array.isArray(refunds) || refunds.length === 0) {
        return res.status(400).json({ message: "Refund details are required" });
      }

      const result = await Order.recordRefundReturn(order_id, refunds);

      return res.json(result);

    } catch (err) {
      logger.error("❌ Admin record refund failed:", err);
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  },


  adminRecordRefund: async (req, res) => {
    try {
      const { order_id, refunds = [] } = req.body;

      if (!order_id) {
        return res.status(400).json({ message: "order_id is required" });
      }

      const result = await Order.recordRefundCancel(order_id, refunds);

      res.json(result);
    } catch (err) {
      logger.error("❌ Admin record refund failed:", err);
      res.status(500).json({
        message: "Error recording refund",
        error: err.message,
      });
    }
  },

  markOrderAsShipped: async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { orderId } = req.params;
      const { courier_name, courier_tracking_id, date_of_shipment } = req.body;

      // ===========================
      // 1️⃣ VALIDATION
      // ===========================
      if (!courier_name || !courier_tracking_id || !date_of_shipment) {
        return res.status(400).json({
          success: false,
          message: "courier_name, courier_tracking_id and date_of_shipment are required",
        });
      }

      if (isNaN(Date.parse(date_of_shipment))) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format for date_of_shipment",
        });
      }

      // BEGIN TRANSACTION
      await conn.beginTransaction();

      // ===========================
      // 2️⃣ FETCH & LOCK ORDER (Prevent race conditions)
      // ===========================
      const [orderRows] = await conn.query(
        `SELECT order_id, order_status 
       FROM orders 
       WHERE order_id = ?
       FOR UPDATE`,
        [orderId]
      );

      if (orderRows.length === 0) {
        await conn.rollback();
        return res.status(404).json({ success: false, message: "Order not found" });
      }

      // Prevent shipping twice
      if (orderRows[0].order_status === "SHIPPED") {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: "Order is already marked as SHIPPED",
        });
      }

      // ===========================
      // 3️⃣ Check if ANY CONFIRMED items left to ship
      // ===========================
      const [remainingItems] = await conn.query(
        `SELECT COUNT(*) AS cnt 
       FROM order_items 
       WHERE order_id = ? AND item_status = 'CONFIRMED'`,
        [orderId]
      );

      if (remainingItems[0].cnt === 0) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: "No confirmed items to ship. Only confirmed items can be shipped.",
        });
      }

      // ===========================
      // 4️⃣ UPDATE ORDER TABLE
      // ===========================
      await conn.query(
        `UPDATE orders 
       SET courier_name = ?, courier_tracking_id = ?, date_of_shipment = ?, order_status = 'SHIPPED'
       WHERE order_id = ?`,
        [courier_name, courier_tracking_id, date_of_shipment, orderId]
      );

      // ===========================
      // 5️⃣ UPDATE ONLY CONFIRMED ITEMS
      // ===========================
      await conn.query(
        `UPDATE order_items 
       SET item_status = 'SHIPPED'
       WHERE order_id = ? AND item_status = 'CONFIRMED'`,
        [orderId]
      );

      // COMMIT
      await conn.commit();

      // ===========================
      // 📧 SEND SHIPMENT EMAIL (AFTER COMMIT)
      // ===========================
      try {
        const [[order]] = await pool.query(
          `SELECT
            o.order_id,
            o.shipping_name,
            o.shipping_email,
            o.total_amount,
            p.payment_method
         FROM orders o
         JOIN payments p ON p.order_id = o.order_id
         WHERE o.order_id = ?
         ORDER BY p.created_at DESC
         LIMIT 1`,
          [orderId]
        );

        const [items] = await pool.query(
          `SELECT
                  oi.quantity,
                  oi.price,
                  oi.subtotal AS sub_total,
                  p.name AS product_name,
                  pv.variant_name
               FROM order_items oi
               JOIN products p ON p.id = oi.product_id
               JOIN product_variants pv ON pv.id = oi.variant_id
               WHERE oi.order_id = ?
                 AND oi.item_status = 'SHIPPED'`,
          [orderId]
        );

        if (!order?.shipping_email) {
          logger.warn(
            "Shipment email skipped: shipping_email not found",
            orderId
          );
        } else if (!items.length) {
          logger.warn(
            "Shipment email skipped: no shipped items",
            orderId
          );
        } else {
          setImmediate(() => {
            shipmentEmailService.sendShipmentEmail({
              order,
              items,
              courier: {
                courier_name,
                courier_tracking_id,
                date_of_shipment,
              },
            });
          });

          logger.info("Shipment email triggered for order:", orderId);
        }
      } catch (emailErr) {
        logger.error("Shipment email failed:", emailErr.message);
      }

      return res.json({
        success: true,
        message: "Order marked as shipped successfully",
        data: { orderId, courier_name, courier_tracking_id, date_of_shipment },
      });

    } catch (err) {
      logger.error("❌ markOrderAsShipped error:", err);

      try { await conn.rollback(); } catch (e) { }

      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    } finally {
      conn.release();
    }
  },

  markOrderAsDelivered: async (req, res) => {
    const conn = await pool.getConnection();

    try {
      const { orderId } = req.params;

      if (!orderId) {
        return res.status(400).json({
          success: false,
          message: "orderId is required",
        });
      }

      await conn.beginTransaction();

      // ---------------------- UPDATE ORDER ----------------------
      const [orderResult] = await conn.query(
        `UPDATE orders
       SET order_status = 'DELIVERED'
       WHERE order_id = ?`,
        [orderId]
      );

      if (orderResult.affectedRows === 0) {
        await conn.rollback();
        return res.status(404).json({ success: false, message: "Order not found" });
      }

      // ---------------------- UPDATE ONLY VALID ITEMS ----------------------
      const [itemResult] = await conn.query(
        `UPDATE order_items 
       SET item_status = 'DELIVERED'
       WHERE order_id = ?
       AND item_status NOT IN ('CANCELLED', 'REFUNDED', 'RETURNED')`,
        [orderId]
      );

      await conn.commit();

      // ===========================
      // 📧 SEND DELIVERED EMAIL (AFTER COMMIT)
      // ===========================
      try {
        // 1️⃣ Fetch order + payment method
        const [[order]] = await pool.query(
          `SELECT
        o.order_id,
        o.shipping_name,
        o.shipping_email,
        o.total_amount,
        p.payment_method
     FROM orders o
     JOIN payments p ON p.order_id = o.order_id
     WHERE o.order_id = ?
     ORDER BY p.created_at DESC
     LIMIT 1`,
          [orderId]
        );

        if (!order?.shipping_email) {
          logger.warn("Delivery email skipped: shipping_email missing", orderId);
        } else {
          // 2️⃣ Fetch ONLY delivered items
          const [items] = await pool.query(
            `SELECT
          oi.quantity,
          oi.price,
          oi.subtotal AS sub_total,
          p.name AS product_name,
          pv.variant_name
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN product_variants pv ON pv.id = oi.variant_id
       WHERE oi.order_id = ?
         AND oi.item_status = 'DELIVERED'`,
            [orderId]
          );

          if (!items.length) {
            logger.warn("Delivery email skipped: no delivered items", orderId);
          } else {
            setImmediate(() => {
              deliveryEmailService.sendDeliveryEmail({
                order,
                items
              });
            });

            logger.info("📬 Delivery email triggered for order:", orderId);
          }
        }
      } catch (emailErr) {
        logger.error("📧 Delivery email failed:", emailErr.message);
      }


      return res.json({
        success: true,
        message: "Order marked as delivered successfully",
        updated_items: itemResult.affectedRows,
        data: { orderId }
      });

    } catch (err) {
      logger.error("❌ markOrderAsDelivered error:", err);
      if (conn) await conn.rollback();
      res.status(500).json({ success: false, message: "Internal server error" });
    } finally {
      if (conn) conn.release();
    }
  },



  // ----------------- Other admin methods -----------------
  adminListOrders: async (req, res) => {
    try {
      const result = await Order.getAllOrders(req.query);
      return res.json({
        message: "Orders fetched successfully",
        ...result
      });
    } catch (err) {
      logger.error("❌ Admin list orders failed:", err);
      return res
        .status(500)
        .json({ message: "Error fetching orders", error: err.message });
    }
  },

  // 🟡 Get All Pending Orders
  adminListPendingOrders: async (req, res) => {
    try {
      const result = await Order.getAllPendingOrders(req.query);
      return res.json({
        message: "Pending orders fetched successfully",
        ...result,
      });
    } catch (err) {
      logger.error("❌ Admin list pending orders failed:", err);
      return res
        .status(500)
        .json({ message: "Error fetching pending orders", error: err.message });
    }
  },

  // 🔵 Get All Confirmed Orders
  adminListConfirmedOrders: async (req, res) => {
    try {
      const result = await Order.getAllConfirmedOrders(req.query);
      return res.json({
        message: "Confirmed orders fetched successfully",
        ...result,
      });
    } catch (err) {
      logger.error("❌ Admin list confirmed orders failed:", err);
      return res
        .status(500)
        .json({ message: "Error fetching confirmed orders", error: err.message });
    }
  },

  adminCancelOrder: async (req, res) => {
    try {
      const { order_id, order_item_ids } = req.body; // optional: array for item cancel
      if (!order_id) {
        return res.status(400).json({ message: "order_id is required" });
      }

      const result = await Order.cancelOrder(order_id, order_item_ids || []);
      res.json(result);
    } catch (err) {
      logger.error("❌ Admin cancel order failed:", err);
      res.status(500).json({
        message: "Error cancelling order",
        error: err.message,
      });
    }
  },


  adminMarkReturnRequest: async (req, res) => {
    try {
      const { order_id, items = [] } = req.body;
      const result = await Order.markReturnRequest(order_id, items);
      return res.json(result);
    } catch (err) {
      logger.error("❌ Admin mark return request failed:", err);
      return res.status(500).json({ message: "Error marking return request" });
    }
  },

  adminReturnOrder: async (req, res) => {
    try {
      const { order_id, order_item_ids } = req.body;

      if (!order_id) {
        return res.status(400).json({
          success: false,
          message: "order_id is required"
        });
      }

      const result = await Order.returnOrder(order_id, order_item_ids);

      return res.status(200).json(result);

    } catch (err) {
      logger.error("❌ adminReturnOrder failed:", err);

      return res.status(500).json({
        success: false,
        message: err.message
      });
    }
  },

  // new return

  // 🟣 Get All Shipped Orders
  adminListShippedOrders: async (req, res) => {
    try {
      const result = await Order.getAllShippedOrders(req.query);
      return res.json({
        message: "Shipped orders fetched successfully",
        ...result,
      });
    } catch (err) {
      logger.error("❌ Admin list shipped orders failed:", err);
      return res
        .status(500)
        .json({ message: "Error fetching shipped orders", error: err.message });
    }
  },

  // 🟢 Get All Delivered Orders
  adminListDeliveredOrders: async (req, res) => {
    try {
      const result = await Order.getAllDeliveredOrders(req.query);
      return res.json({
        message: "Delivered orders fetched successfully",
        ...result,
      });
    } catch (err) {
      logger.error("❌ Admin list delivered orders failed:", err);
      return res
        .status(500)
        .json({ message: "Error fetching delivered orders", error: err.message });
    }
  },

  // 🔴 Get All Returned Orders
  adminListReturnedOrders: async (req, res) => {
    try {
      const result = await Order.getAllReturnedOrders(req.query);
      return res.json({
        message: "Returned orders fetched successfully",
        ...result,
      });
    } catch (err) {
      logger.error("❌ Admin list returned orders failed:", err);
      return res
        .status(500)
        .json({ message: "Error fetching returned orders", error: err.message });
    }
  },

  // ⚫ Get All Cancelled Orders
  adminListCancelledOrders: async (req, res) => {
    try {
      const result = await Order.getAllCancelledOrders(req.query);
      return res.json({
        message: "Cancelled orders fetched successfully",
        ...result,
      });
    } catch (err) {
      logger.error("❌ Admin list cancelled orders failed:", err);
      return res
        .status(500)
        .json({ message: "Error fetching cancelled orders", error: err.message });
    }
  },

  // 🟡 Get All Pending Orders
  adminListPendingOrders: async (req, res) => {
    try {
      const result = await Order.getAllPendingOrders(req.query);
      return res.json({
        message: "Pending orders fetched successfully",
        ...result,
      });
    } catch (err) {
      logger.error("❌ Admin list pending orders failed:", err);
      return res
        .status(500)
        .json({ message: "Error fetching pending orders", error: err.message });
    }
  },

  // 🔵 Get All Confirmed Orders
  adminListConfirmedOrders: async (req, res) => {
    try {
      const result = await Order.getAllConfirmedOrders(req.query);
      return res.json({
        message: "Confirmed orders fetched successfully",
        ...result,
      });
    } catch (err) {
      logger.error("❌ Admin list confirmed orders failed:", err);
      return res
        .status(500)
        .json({ message: "Error fetching confirmed orders", error: err.message });
    }
  },

  // 🟤 Get All Return Request Orders
  adminListReturnRequestOrders: async (req, res) => {
    try {
      const result = await Order.getAllReturnRequestOrders(req.query);
      return res.json({
        message: "Return request orders fetched successfully",
        ...result,
      });
    } catch (err) {
      logger.error("❌ Admin list return request orders failed:", err);
      return res
        .status(500)
        .json({ message: "Error fetching return request orders", error: err.message });
    }
  },

  // 🟣 Get All Partially Returned Orders
  adminListPartiallyReturnedOrders: async (req, res) => {
    try {
      const result = await Order.getAllPartiallyReturnedOrders(req.query);
      return res.json({
        message: "Partially returned orders fetched successfully",
        ...result,
      });
    } catch (err) {
      logger.error("❌ Admin list partially returned orders failed:", err);
      return res
        .status(500)
        .json({ message: "Error fetching partially returned orders", error: err.message });
    }
  },

  // ⚫ Get All Partially Cancelled Orders
  adminListPartiallyCancelledOrders: async (req, res) => {
    try {
      const result = await Order.getAllPartiallyCancelledOrders(req.query);
      return res.json({
        message: "Partially cancelled orders fetched successfully",
        ...result,
      });
    } catch (err) {
      logger.error("❌ Admin list partially cancelled orders failed:", err);
      return res
        .status(500)
        .json({ message: "Error fetching partially cancelled orders", error: err.message });
    }
  },

  // 🟢 Get All Refunded Orders
  adminListRefundedOrders: async (req, res) => {
    try {
      const result = await Order.getAllRefundedOrders(req.query);
      return res.json({
        message: "Refunded orders fetched successfully",
        ...result,
      });
    } catch (err) {
      logger.error("❌ Admin list refunded orders failed:", err);
      return res
        .status(500)
        .json({ message: "Error fetching refunded orders", error: err.message });
    }
  },

  // 🟢 Get All Partially Refunded Orders
  adminListPartiallyRefundedOrders: async (req, res) => {
    try {
      const result = await Order.getAllPartiallyRefundedOrders(req.query);
      return res.json({
        message: "Partially refunded orders fetched successfully",
        ...result,
      });
    } catch (err) {
      logger.error("❌ Admin list partially refunded orders failed:", err);
      return res
        .status(500)
        .json({ message: "Error fetching partially refunded orders", error: err.message });
    }
  },


  adminUpdateOrderStatus: async (req, res) => {
    try {
      const { orderId } = req.params;
      const { status } = req.body;

      await Order.updateOrderStatus(orderId, status);

      return res.json({ message: `Order status updated to ${status}` });
    } catch (err) {
      logger.error("❌ Admin update order status failed:", err);
      return res.status(500).json({
        message: "Error updating order status",
        error: err.message,
      });
    }
  },


  getOrder: async (req, res) => {
    try {
      const { orderId } = req.params;
      const order = await Order.getOrderById(orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });
      return res.json({ message: "Order fetched", data: order });
    } catch (err) {
      logger.error("❌ Get order failed:", err);
      return res.status(500).json({ message: "Error fetching order production issues", error: err.message, err: err });
    }
  },

  // ----------------- User: Get My Orders -----------------
  getUserOrders: async (req, res) => {
    try {
      const user_id = Number(req.user?.id);
      if (!user_id) return res.status(401).json({ message: "Unauthorized" });

      const { status } = req.query; // Optional filter

      // 1️⃣ Fetch user orders with all required fields
      const [orders] = await pool.query(
        `SELECT 
         o.order_id,
         o.user_id,
         o.address_id,
         o.shipping_name,
         o.shipping_phone,
         o.shipping_street,
         o.shipping_city,
         o.shipping_state,
         o.shipping_zip,
         o.shipping_country,
         o.gst_number,
         o.total_amount,
         o.total_discount_amount,
         o.total_shipping_price,
         o.order_status,
         o.order_coupon_id,
         o.order_coupon_code,
         o.created_at,
         o.updated_at,
         o.courier_name,
         o.courier_tracking_id,
         o.date_of_shipment,
         o.cod_charge,
         o.cod_charge_type,
         o.cod_charge_rate,
         o.additional_charge,
         o.additional_charge_type,
         o.additional_charge_rate,
         p.status AS payment_status,
         p.payment_method
       FROM orders o
       LEFT JOIN payments p ON o.order_id = p.order_id
       WHERE o.user_id = ?
       ${status ? "AND o.order_status = ?" : ""}
       ORDER BY o.created_at DESC`,
        status ? [user_id, status] : [user_id]
      );

      if (!orders.length)
        return res.json({ message: "No orders found", data: [] });

      // 2️⃣ Fetch order items
      const orderIds = orders.map((o) => o.order_id);
      const [items] = await pool.query(
        `SELECT 
         oi.order_item_id,
         oi.order_id,
         oi.product_id,
         p.name AS product_name,
         v.variant_name,
         oi.quantity,
         oi.price
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN product_variants v ON v.id = oi.variant_id
       WHERE oi.order_id IN (?)
       ORDER BY oi.order_id`,
        [orderIds]
      );

      // 3️⃣ Group items under orders
      const orderMap = {};
      orders.forEach((o) => {
        orderMap[o.order_id] = { ...o, items: [] };
      });

      items.forEach((item) => {
        if (orderMap[item.order_id]) {
          orderMap[item.order_id].items.push({
            order_item_id: item.order_item_id,
            product_id: item.product_id,
            product_name: item.product_name,
            variant_name: item.variant_name,
            quantity: item.quantity,
            price: item.price,
          });
        }
      });

      // 4️⃣ Final clean response
      return res.json({
        message: "User orders fetched successfully",
        data: Object.values(orderMap),
      });
    } catch (err) {
      logger.error("❌ getUserOrders failed:", err);
      return res
        .status(500)
        .json({ message: "Error fetching user orders", error: err.message });
    }
  },





};

module.exports = orderController;
