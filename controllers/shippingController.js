const { error } = require("winston");
const logger = require("../utils/logger");
// src/controllers/shiprocketController.js
const axios = require("axios");
require("dotenv").config();

const {
  SHIPROCKET_EMAIL,
  SHIPROCKET_PASSWORD,
  SHIPROCKET_AUTH_URL,
  SHIPROCKET_BASE_URL,
  DIMENSION_DIVISOR // optional env var, default 5000
} = process.env;

const DIM_DIVISOR = Number(DIMENSION_DIVISOR) || 5000; // typical divisor for cm -> kg

let cachedToken = null;
let tokenExpiry = null;

/**
 * Authenticate with Shiprocket (cached for 1 hour)
 */
async function getAuthToken() {
  if (cachedToken && tokenExpiry && new Date() < tokenExpiry) {
    return cachedToken;
  }

  try {
    const resp = await axios.post(SHIPROCKET_AUTH_URL, {
      email: SHIPROCKET_EMAIL,
      password: SHIPROCKET_PASSWORD
    });

    cachedToken = resp.data.token;
    tokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour cache
    return cachedToken;
  } catch (err) {
    logger.error("Shiprocket Auth Error:", err.response?.data || err.message);
    throw new Error("Unable to authenticate with Shiprocket");
  }
}

/**
 * Calculate shipping: accounts for L x B x H, weight and quantity per item.
 * POST body:
 * {
 *   pickup_postcode: string,
 *   delivery_postcode: string,
 *   cod: 0|1,
 *   cartItems: [
 *     { product_id?, weight, length, breadth, height, declared_value, quantity }
 *   ],
 *   mode: "Surface" | "Air" (optional)
 * }
 */
async function calculateShipping(req, res) {
  try {
    const { pickup_postcode, delivery_postcode, cod, cartItems, mode } = req.body;

    // Basic validation
    if (!pickup_postcode || !delivery_postcode) {
      return res.status(400).json({ message: "pickup_postcode and delivery_postcode are required." });
    }
    if (cod === undefined) {
      return res.status(400).json({ message: "cod (0 or 1) is required." });
    }
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ message: "cartItems must be a non-empty array." });
    }

    // Compute per-item totals (physical, volumetric, chargeable)
    const processedItems = [];
    let totalChargeableWeight = 0;
    let totalDeclaredValue = 0;
    let totalVolumeCm3 = 0;

    for (let i = 0; i < cartItems.length; i++) {
      const item = cartItems[i];

      // Validate critical fields
      const qty = Number(item.quantity ?? 1);
      const unitWeight = Number(item.weight);
      if (!unitWeight || unitWeight <= 0) {
        return res.status(400).json({ message: `Invalid weight for cart item at index ${i}` });
      }
      if (!qty || qty <= 0) {
        return res.status(400).json({ message: `Invalid quantity for cart item at index ${i}` });
      }

      const length = Number(item.length);   // cm default
      const breadth = Number(item.breadth);
      const height = Number(item.height);
      const declaredValueUnit = Number(item.declared_value);

      if (cod == 1 && (!declaredValueUnit || declaredValueUnit <= 0)) {
        return res.status(400).json({
          message: `Declared value must be greater than 0 for COD shipments (item index ${i}).`
        });
      }


      // Validate dimensions
      if (!Number.isFinite(length) || length <= 0) {
        return res.status(400).json({
          message: `Invalid or missing length for cart item at index ${i}`
        });
      }

      if (!Number.isFinite(breadth) || breadth <= 0) {
        return res.status(400).json({
          message: `Invalid or missing breadth for cart item at index ${i}`
        });
      }

      if (!Number.isFinite(height) || height <= 0) {
        return res.status(400).json({
          message: `Invalid or missing height for cart item at index ${i}`
        });
      }


      // physical total weight (kg)
      const physicalTotal = unitWeight * qty;

      // volumetric weight per unit (kg) = (L * B * H) / DIM_DIVISOR
      const volumetricPerUnit = (length * breadth * height) / DIM_DIVISOR;
      const volumetricTotal = volumetricPerUnit * qty;

      // chargeable weight for this item (kg)
      const chargeableWeight = Math.max(physicalTotal, volumetricTotal);

      // keep totals
      totalChargeableWeight += chargeableWeight;
      totalDeclaredValue += declaredValueUnit * qty;
      totalVolumeCm3 += (length * breadth * height) * qty;

      processedItems.push({
        ...item,
        quantity: qty,
        unit_weight: unitWeight,
        physical_total_weight: +physicalTotal.toFixed(3),
        volumetric_per_unit: +volumetricPerUnit.toFixed(3),
        volumetric_total: +volumetricTotal.toFixed(3),
        chargeable_weight: +chargeableWeight.toFixed(3)
      });
    }

    if (cod == 1 && totalDeclaredValue <= 0) {
      return res.status(400).json({
        message: "Declared value cannot be 0 for COD shipments."
      });


    }

    if (totalChargeableWeight <= 0) {
      return res.status(400).json({ message: "Total chargeable weight calculated as 0 — check item weights/quantities." });
    }

    // Dimensions for the shipment request.
    // Simple heuristic: use max of dimensions (largest single item) — acceptable approximation.
    const lengths = cartItems.map(it => Number(it.length));
    const breadths = cartItems.map(it => Number(it.breadth));
    const heights = cartItems.map(it => Number(it.height));

    if (lengths.some(v => !Number.isFinite(v) || v <= 0)) {
      return res.status(400).json({ message: "Invalid length value in cart items" });
    }
    if (breadths.some(v => !Number.isFinite(v) || v <= 0)) {
      return res.status(400).json({ message: "Invalid breadth value in cart items" });
    }
    if (heights.some(v => !Number.isFinite(v) || v <= 0)) {
      return res.status(400).json({ message: "Invalid height value in cart items" });
    }

    const maxLength = Math.max(...lengths);
    const maxBreadth = Math.max(...breadths);
    const maxHeight = Math.max(...heights);
    // Round request weight to 2 decimals (or per carrier rules you can ceil to next 0.5/1kg)
    const requestWeight = Math.ceil(totalChargeableWeight * 100) / 100; // 2 decimals, rounded up

    // Prepare Shiprocket request
    const token = await getAuthToken();

    const params = new URLSearchParams({
      pickup_postcode,
      delivery_postcode,
      weight: requestWeight,
      cod,
      length: maxLength,
      breadth: maxBreadth,
      height: maxHeight,
      declared_value: Math.ceil(totalDeclaredValue), // integer ok
      mode: mode || "Surface"
    });

    const url = `${SHIPROCKET_BASE_URL}/courier/serviceability/?${params.toString()}`;

    const apiResp = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      timeout: 10000
    });

    console.log(apiResp.data);

    const courierList = apiResp.data?.data?.available_courier_companies || [];

    if (!Array.isArray(courierList) || courierList.length === 0) {
      return res.status(404).json({
        message: "No couriers available for this pincode",
        total_shipping_price: 0,
        shipping_error: apiResp.data.error,
        shipping_message: apiResp.data.message,
        details: { totalChargeableWeight: +totalChargeableWeight.toFixed(3), totalDeclaredValue }
      });
    }

    // Choose the courier with minimum rate
    let minCourier = courierList[0];
    for (let c of courierList) {
      if (Number(c.rate) < Number(minCourier.rate)) minCourier = c;
    }

    const total_shipping_price = Number(minCourier.rate); // shipping for the whole shipment

    if (total_shipping_price <= 0) {
      return res.status(400).json({
        message: "Shipping is not available",
        total_shipping_price: 0
      });
    }

    // Distribute total_shipping_price across items by chargeable weight proportion
    // Ensure rounding doesn't lose small cents by adjusting last item
    const perItemShares = [];
    let assignedSum = 0;

    for (let i = 0; i < processedItems.length; i++) {
      const it = processedItems[i];
      const proportion = it.chargeable_weight / totalChargeableWeight;
      // keep 2 decimals
      const share = i < processedItems.length - 1
        ? Number((total_shipping_price * proportion).toFixed(2))
        : null; // compute last later
      perItemShares.push(share);
      if (share !== null) assignedSum += share;
    }

    // last item adjustment
    const lastIndex = processedItems.length - 1;
    const lastShare = Number((total_shipping_price - assignedSum).toFixed(2));
    perItemShares[lastIndex] = lastShare;

    // Attach item shipping info
    const perItemShipping = processedItems.map((it, idx) => ({
      product_id: it.product_id ?? null,
      variant_id: it.variant_id ?? null,
      quantity: it.quantity,
      unit_weight: it.unit_weight,
      physical_total_weight: it.physical_total_weight,
      volumetric_per_unit: it.volumetric_per_unit,
      volumetric_total: it.volumetric_total,
      chargeable_weight: it.chargeable_weight,
      item_shipping_cost: perItemShares[idx]
    }));

    // Response
    return res.status(200).json({
      message: "Total shipping price calculated using per-item dimensions & quantities",
      courier_name: minCourier.courier_name,
      courier_id: minCourier.courier_id ?? null,
      estimated_delivery_days: minCourier.estimated_delivery_days ?? null,
      pickup_postcode,
      delivery_postcode,
      cod,
      dimension_divisor: DIM_DIVISOR,
      total_volume_cm3: Math.round(totalVolumeCm3),
      total_chargeable_weight: +totalChargeableWeight.toFixed(3),
      request_weight_sent: requestWeight,
      totalDeclaredValue: +totalDeclaredValue.toFixed(2),
      total_shipping_price: Number(total_shipping_price.toFixed(2)),
      cartItemsCount: cartItems.length,
      perItemShipping
    });

  } catch (err) {
    // axios / network / other errors
    if (err.response) {
      logger.error("Shiprocket API Error:", err.response.data);
      return res.status(err.response.status || 500).json({
        message: "Shiprocket API returned an error",
        error: err.response.data
      });
    } else if (err.request) {
      logger.error("No response from Shiprocket API:", err.message);
      return res.status(503).json({
        message: "No response from Shiprocket API",
        error: err.message
      });
    } else {
      logger.error("Shipping calculation error:", err.message);
      return res.status(500).json({
        message: "Failed to calculate shipping",
        error: err.message
      });
    }
  }
}

module.exports = { calculateShipping };



// // src/controllers/shiprocketController.js
// const axios = require("axios");
// require("dotenv").config();

// const {
//   SHIPROCKET_EMAIL,
//   SHIPROCKET_PASSWORD,
//   SHIPROCKET_AUTH_URL,
//   SHIPROCKET_BASE_URL
// } = process.env;

// let cachedToken = null;
// let tokenExpiry = null;

// /**
//  * Authenticate with Shiprocket (cached for 1 hour)
//  */
// async function getAuthToken() {
//   if (cachedToken && tokenExpiry && new Date() < tokenExpiry) {
//     return cachedToken;
//   }

//   try {
//     const response = await axios.post(SHIPROCKET_AUTH_URL, {
//       email: SHIPROCKET_EMAIL,
//       password: SHIPROCKET_PASSWORD
//     });

//     cachedToken = response.data.token;
//     tokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // Cache 1 hour
//     return cachedToken;
//   } catch (err) {
//     logger.error("Shiprocket Auth Error:", err.response?.data || err.message);
//     throw new Error("Unable to authenticate with Shiprocket");
//   }
// }

// /**
//  * Controller: Calculate Minimum Shipping Price for multiple cart items
//  * Method: POST
//  * Body params:
//  *   - pickup_postcode (required)
//  *   - delivery_postcode (required)
//  *   - cod (required, 0 or 1)
//  *   - cartItems: array of { weight, length, breadth, height, declared_value } (required)
//  * Optional:
//  *   - mode (Surface/Air)
//  */
// async function calculateShipping(req, res) {
//   try {
//     const { pickup_postcode, delivery_postcode, cod, cartItems, mode } = req.body;

//     // ✅ Validation
//     if (!pickup_postcode || !delivery_postcode || cod === undefined || !Array.isArray(cartItems) || cartItems.length === 0) {
//       return res.status(400).json({
//         message: "pickup_postcode, delivery_postcode, cod (0 or 1), and cartItems (non-empty array) are required."
//       });
//     }

//     // Validate each cart item
//     for (let i = 0; i < cartItems.length; i++) {
//       const item = cartItems[i];
//       if (!item.weight || item.weight <= 0) {
//         return res.status(400).json({ message: `Invalid weight for cart item at index ${i}` });
//       }
//       // Optional: length, breadth, height defaults will be applied later
//     }

//     // Aggregate cart items
//     const totalWeight = cartItems.reduce((sum, item) => sum + item.weight, 0);
//     const maxLength = Math.max(...cartItems.map(item => item.length || 10));
//     const maxBreadth = Math.max(...cartItems.map(item => item.breadth || 10));
//     const maxHeight = Math.max(...cartItems.map(item => item.height || 10));
//     const totalDeclaredValue = cartItems.reduce((sum, item) => sum + (item.declared_value || 100), 0);

//     const token = await getAuthToken();

//     // Build Shiprocket API URL
//     const params = new URLSearchParams({
//       pickup_postcode,
//       delivery_postcode,
//       weight: totalWeight,
//       cod,
//       length: maxLength,
//       breadth: maxBreadth,
//       height: maxHeight,
//       declared_value: totalDeclaredValue,
//       mode: mode || "Surface"
//     });

//     const url = `${SHIPROCKET_BASE_URL}/courier/serviceability/?${params.toString()}`;

//     // Make API call
//     const response = await axios.get(url, {
//       headers: {
//         Authorization: `Bearer ${token}`,
//         "Content-Type": "application/json"
//       },
//       timeout: 10000 // 10 seconds timeout
//     });

//     const courierList = response.data?.data?.available_courier_companies || [];

//     if (!courierList.length) {
//       return res.status(404).json({
//         message: "No couriers available for this route",
//         minimum_price: 0
//       });
//     }

//     // Find the courier with minimum rate
//     const minCourier = courierList.reduce((min, curr) =>
//       curr.rate < min.rate ? curr : min
//     );

//     res.status(200).json({
//       message: "Minimum shipping price fetched successfully",
//       minimum_price: minCourier.rate,
//       courier_name: minCourier.courier_name,
//       estimated_delivery_days: minCourier.estimated_delivery_days,
//       pickup_postcode,
//       delivery_postcode,
//       totalWeight,
//       cod,
//       cartItemsCount: cartItems.length
//     });

//   } catch (err) {
//     // Handle Axios errors
//     if (err.response) {
//       logger.error("Shiprocket API Error:", err.response.data);
//       return res.status(err.response.status || 500).json({
//         message: "Shiprocket API returned an error",
//         error: err.response.data
//       });
//     } else if (err.request) {
//       logger.error("No response from Shiprocket API:", err.message);
//       return res.status(503).json({
//         message: "No response from Shiprocket API",
//         error: err.message
//       });
//     } else {
//       logger.error("Shipping calculation error:", err.message);
//       return res.status(500).json({
//         message: "Failed to calculate shipping",
//         error: err.message
//       });
//     }
//   }
// }

// module.exports = { calculateShipping };
