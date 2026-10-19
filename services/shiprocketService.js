const logger = require("../utils/logger");
// src/services/shiprocketService.js
const axios = require("axios");
require("dotenv").config();

const {
  SHIPROCKET_EMAIL,
  SHIPROCKET_PASSWORD,
  SHIPROCKET_AUTH_URL,
  SHIPROCKET_SHIPPING_URL
} = process.env;

let cachedToken = null;
let tokenExpiry = null;

/**
 * Get Shiprocket Auth Token (cached)
 */
async function getAuthToken() {
  if (cachedToken && tokenExpiry && new Date() < tokenExpiry) {
    return cachedToken;
  }

  try {
    const response = await axios.post(SHIPROCKET_AUTH_URL, {
      email: SHIPROCKET_EMAIL,
      password: SHIPROCKET_PASSWORD
    });

    cachedToken = response.data.token;
    // Token expiry: usually 1 hour
    tokenExpiry = new Date(new Date().getTime() + 60 * 60 * 1000);
    return cachedToken;
  } catch (err) {
    logger.error("Shiprocket Auth Error:", err.response?.data || err.message);
    throw new Error("Unable to authenticate with Shiprocket");
  }
}

/**
 * Calculate shipping price
 * @param {Object} options
 * @param {string} options.pickup_postcode
 * @param {string} options.delivery_postcode
 * @param {number} options.weight
 * @param {number} options.length
 * @param {number} options.width
 * @param {number} options.height
 * @returns {Promise<{minimum_price: number, all_rates: Array}>}
 */
async function calculateShipping({ pickup_postcode, delivery_postcode, weight, length, width, height }) {
  try {
    const token = await getAuthToken();

    const payload = {
      pickup_postcode,
      delivery_postcode,
      weight,
      length,
      breadth: width,
      height,
      cod: 0 // Cash on delivery not required for calculation
    };

    const response = await axios.post(`${SHIPROCKET_SHIPPING_URL}/courier/serviceability/`, payload, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const rates = response.data.data?.available_courier_companies || [];

    if (!rates.length) {
      return { minimum_price: 0, all_rates: [] };
    }

    // Minimum price from available courier companies
    const minRate = Math.min(...rates.map(r => r.rate));
    return { minimum_price: minRate, all_rates: rates };
  } catch (err) {
    logger.error("Shiprocket Shipping Calculation Error:", err.response?.data || err.message);
    // If shipping API fails, fallback to 0
    return { minimum_price: 0, all_rates: [] };
  }
}

module.exports = {
  calculateShipping
};
