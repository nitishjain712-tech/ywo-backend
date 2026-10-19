require("dotenv").config();
const logger = require("../utils/logger");
const pLimit = require("p-limit").default;

// ===================== RATE LIMITER =====================
const limit = pLimit(5); // Max 5 concurrent PhonePe calls

// ===================== LAZY SDK & CLIENT LOADER =====================
let cachedPhonePeSdk = null;
let cachedPhonePeClient = null;

function getPhonePeSdk() {
  if (cachedPhonePeSdk) return cachedPhonePeSdk;
  try {
    cachedPhonePeSdk = require("pg-sdk-node");
    return cachedPhonePeSdk;
  } catch (err) {
    if (
      err.code === "MODULE_NOT_FOUND" &&
      (err.message.includes("pg-sdk-node") || err.requireStack?.[0]?.includes("phonepeService"))
    ) {
      const sdkError = new Error(
        "PhonePe SDK ('pg-sdk-node') is not installed or unavailable. Ensure PhonePe SDK is installed to use PhonePe payment gateway."
      );
      sdkError.code = "PHONEPE_SDK_NOT_INSTALLED";
      throw sdkError;
    }
    throw err;
  }
}

function getPhonePeClient() {
  if (cachedPhonePeClient) {
    return { client: cachedPhonePeClient, sdk: cachedPhonePeSdk };
  }

  const sdk = getPhonePeSdk();

  const {
    PHONEPE_CLIENT_ID,
    PHONEPE_CLIENT_SECRET,
    PHONEPE_CLIENT_VERSION,
    PHONEPE_ENV = "PROD",
  } = process.env;

  if (!PHONEPE_CLIENT_ID || !PHONEPE_CLIENT_SECRET || !PHONEPE_CLIENT_VERSION) {
    throw new Error("❌ Missing PhonePe credentials in .env");
  }

  const env =
    PHONEPE_ENV === "PROD"
      ? sdk.Env.PRODUCTION
      : sdk.Env.SANDBOX;

  logger.info(`[PhonePe] Environment: ${PHONEPE_ENV}`);

  cachedPhonePeClient = sdk.StandardCheckoutClient.getInstance(
    PHONEPE_CLIENT_ID,
    PHONEPE_CLIENT_SECRET,
    PHONEPE_CLIENT_VERSION,
    env
  );

  return { client: cachedPhonePeClient, sdk };
}

// ===================== SAFE CALL WRAPPER =====================
async function safePhonePeCall(fn, args = [], retries = 2) {
  return limit(async () => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn(...args);
      } catch (err) {
        const status =
          err?.httpStatusCode ||
          err?.response?.status ||
          null;

        // Retry ONLY transient errors
        if ((status === 429 || status >= 500) && attempt < retries) {
          const delay = 1500 * attempt;
          logger.warn(`[PhonePe] Retry ${attempt}/${retries} after ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // 401 = config / auth error → DO NOT RETRY
        throw err;
      }
    }
  });
}

// ===================== PAYMENT INITIATION =====================
async function initiatePayment(orderId, amount) {
  const { client, sdk } = getPhonePeClient();
  const { MetaInfo, StandardCheckoutPayRequest } = sdk;

  const {
    FRONTEND_URL = "https://waltzify.com",
    BACKEND_URL = "https://www.api.waltzify.com",
  } = process.env;

  const merchantOrderId = `ORD_${orderId}_${Date.now()}`;
  const amountPaise = Math.round(amount * 100);

  const metaInfo = MetaInfo.builder()
    .udf1(`ORDER_${orderId}`)
    .build();

  const request = StandardCheckoutPayRequest.builder()
    .merchantOrderId(merchantOrderId)
    .amount(amountPaise)
    .redirectUrl(`${FRONTEND_URL}/my-orders`)
    .metaInfo(metaInfo)
    .build();

  try {
    const response = await safePhonePeCall(
      client.pay.bind(client),
      [
        request,
        { callbackUrl: `${BACKEND_URL}/api/payment/callback` },
      ]
    );

    return {
      id: response.orderId || merchantOrderId,
      redirectUrl: response.redirectUrl,
      transaction_id: response.orderId,
      merchant_order_id: merchantOrderId,
      raw: response,
    };
  } catch (err) {
    logger.error("❌ PhonePe initiate error", err);
    throw new Error(err?.message || "Payment initiation failed");
  }
}

// ===================== SDK ORDER CREATION =====================
async function createSdkOrder(orderId, amount) {
  const { client, sdk } = getPhonePeClient();
  const { CreateSdkOrderRequest } = sdk;

  const {
    FRONTEND_URL = "https://waltzify.com",
  } = process.env;

  const merchantOrderId = `ORD_${orderId}_${Date.now()}`;
  const amountPaise = Math.round(amount * 100);

  const request = CreateSdkOrderRequest.StandardCheckoutBuilder()
    .merchantOrderId(merchantOrderId)
    .amount(amountPaise)
    .redirectUrl(`${FRONTEND_URL}/my-orders`)
    .build();

  try {
    const response = await safePhonePeCall(
      client.createSdkOrder.bind(client),
      [request]
    );

    return {
      token: response.token,
      orderId: response.orderId,
      state: response.state,
      expireAt: response.expireAt,
    };
  } catch (err) {
    logger.error("❌ PhonePe SDK order error", err);
    throw new Error(err?.message || "Create SDK order failed");
  }
}

// ===================== ORDER STATUS =====================
async function checkOrderStatus(merchantOrderId, details = false) {
  if (!merchantOrderId) {
    throw new Error("Merchant Order ID is required");
  }

  const { client } = getPhonePeClient();

  try {
    const response = await safePhonePeCall(
      client.getOrderStatus.bind(client),
      [merchantOrderId, details]
    );

    const state =
      response?.state ||
      response?.data?.state ||
      response?.data?.orderStatus ||
      "UNKNOWN";

    const dbStatus =
      state === "COMPLETED"
        ? "SUCCESS"
        : state === "FAILED"
        ? "FAILED"
        : state === "PENDING"
        ? "PENDING"
        : "UNKNOWN";

    return {
      merchant_order_id: merchantOrderId,
      order_id: response?.orderId || null,
      state,
      dbStatus,
      paymentDetails:
        response?.paymentDetails ||
        response?.data?.paymentDetails ||
        [],
      raw: response,
    };
  } catch (err) {
    logger.error(`❌ PhonePe status failed for ${merchantOrderId}`, err);
    throw new Error(err?.message || "Unable to fetch order status");
  }
}

// ===================== RETRY WRAPPER =====================
async function checkOrderStatusWithRetry(merchantOrderId, details = false, retries = 2) {
  try {
    return await checkOrderStatus(merchantOrderId, details);
  } catch (err) {
    if (err.code === "PHONEPE_SDK_NOT_INSTALLED" || err.message?.includes("Missing PhonePe credentials")) {
      throw err;
    }
    if (retries > 0) {
      logger.warn(`[Retry] Retrying status check for ${merchantOrderId}...`);
      await new Promise(r => setTimeout(r, 1500));
      return await checkOrderStatusWithRetry(merchantOrderId, details, retries - 1);
    }
    throw err;
  }
}

// ===================== CALLBACK VERIFICATION =====================
function verifyCallbackSignature(
  username,
  password,
  authorizationHeader,
  bodyString
) {
  try {
    const { client } = getPhonePeClient();
    return client.validateCallback(
      username,
      password,
      authorizationHeader,
      bodyString
    );
  } catch (err) {
    logger.error("❌ Callback verification failed", err);
    return false;
  }
}

// ===================== REFUND =====================
async function refundPayment(originalMerchantOrderId, refundAmount) {
  const { client, sdk } = getPhonePeClient();
  const { RefundRequest } = sdk;

  const merchantRefundId = `REFUND_${Date.now()}`;
  const amountPaise = Math.round(refundAmount * 100);

  const request = RefundRequest.builder()
    .merchantRefundId(merchantRefundId)
    .originalMerchantOrderId(originalMerchantOrderId)
    .amount(amountPaise)
    .build();

  try {
    return await safePhonePeCall(
      client.refund.bind(client),
      [request]
    );
  } catch (err) {
    logger.error("❌ PhonePe refund failed", err);
    throw new Error(err?.message || "Refund failed");
  }
}

// ===================== EXPORTS =====================
module.exports = {
  initiatePayment,
  createOrder: initiatePayment,
  createSdkOrder,
  checkOrderStatus,
  verifyCallbackSignature,
  checkOrderStatusWithRetry,
  refundPayment,
};




// above is for testing


// const { StandardCheckoutClient, Env, StandardCheckoutPayRequest, CreateSdkOrderRequest, RefundRequest, MetaInfo } = require("pg-sdk-node");
// const { randomUUID } = require("crypto");
// require("dotenv").config();
// const pool = require("../config/db"); // your mysql2/promise pool
// const logger = require("../utils/logger"); // optional: custom logger (Winston or console)




// const {
//   PHONEPE_CLIENT_ID,
//   PHONEPE_CLIENT_SECRET,
//   PHONEPE_CLIENT_VERSION,
//   FRONTEND_URL = "http://localhost:5173",
//   BACKEND_URL = "http://localhost:8000",
//   PHONEPE_ENV = "SANDBOX", // SANDBOX or PRODUCTION
// } = process.env;

// if (!PHONEPE_CLIENT_ID || !PHONEPE_CLIENT_SECRET || !PHONEPE_CLIENT_VERSION) {
//   logger.warn("⚠️ Missing PhonePe credentials in .env");
// }

// // Initialize PhonePe client
// const env = PHONEPE_ENV === "SANDBOX" ? Env.SANDBOX : Env.PRODUCTION;
// const phonePeClient = StandardCheckoutClient.getInstance(
//   PHONEPE_CLIENT_ID,
//   PHONEPE_CLIENT_SECRET,
//   PHONEPE_CLIENT_VERSION,
//   env
// );

// /**
//  * Initiate Payment (Web Checkout)
//  */
// async function initiatePayment(orderId, amount) {
//   const merchantOrderId = `ORD_${orderId}_${Date.now()}`;
//   const amountPaise = Math.round(amount * 100);

//   const metaInfo = MetaInfo.builder()
//     .udf1(`ORDER_${orderId}`)
//     .build();

//   const request = StandardCheckoutPayRequest.builder()
//     .merchantOrderId(merchantOrderId)
//     .amount(amountPaise)
//     .redirectUrl(`${FRONTEND_URL}/payment/status/${orderId}`)
//     .metaInfo(metaInfo)
//     .build();

//   try {
//     const response = await phonePeClient.pay(request, {
//       callbackUrl: `${BACKEND_URL}/api/payment/callback`,
//     });
// logger.info("PhonePe response:", merchantOrderId);
//     // Return all necessary info
//    return {
//   redirectUrl: response.redirectUrl,
//   transaction_id: response.orderId,       // DB column
//   merchant_order_id: merchantOrderId,     // DB column
//   raw: response,
// };
//   } catch (err) {
//     logger.error("PhonePe initiate error:", err);
//     throw new Error(err?.message || "Payment initiation failed");
//   }
// }




// /**
//  * Create SDK Order (for mobile apps)
//  */
// async function createSdkOrder(orderId, amount) {
//   const merchantOrderId = `ORD_${orderId}_${Date.now()}`;
//   const amountPaise = Math.round(amount * 100);

//   const request = CreateSdkOrderRequest.StandardCheckoutBuilder()
//     .merchantOrderId(merchantOrderId)
//     .amount(amountPaise)
//     .redirectUrl(`${FRONTEND_URL}/payment/status/${orderId}`)
//     .build();

//   try {
//     const response = await phonePeClient.createSdkOrder(request);
//     return {
//       token: response.token,
//       orderId: response.orderId,
//       state: response.state,
//       expireAt: response.expireAt,
//     };
//   } catch (err) {
//     logger.error("PhonePe create SDK order error:", err);
//     throw new Error(err?.message || "Create SDK order failed");
//   }
// }

// /**
//  * Check Order Status
//  * Fetches the status of a specific order using its merchantOrderId.
//  * @param {string} merchantOrderId - The unique order ID provided during initiation.
//  * @param {boolean} [details=false] - If true, returns all payment attempts; otherwise, only the latest.
//  * @returns {Promise<OrderStatusResponse>} The status response object from PhonePe.
//  */
// async function checkOrderStatus(merchantOrderId, details = false) {
//   if (!merchantOrderId) {
//     throw new Error("Merchant Order ID is required to check status.");
//   }

//   try {
//     logger.info(`[PhonePe] Checking status for ${merchantOrderId} (details=${details})`);

//     // 🔹 Call PhonePe SDK or API
//     const response = await phonePeClient.getOrderStatus(merchantOrderId, details);

//     // 🔹 Log full response for debugging (only in dev)
//     if (process.env.NODE_ENV !== "production") {
//       logger.info(`📦 PhonePe raw response for ${merchantOrderId}:`, JSON.stringify(response, null, 2));
//     }

//     // 🔹 Normalize state (some SDKs nest this differently)
//     const state =
//       response?.state ||
//       response?.data?.state ||
//       response?.data?.orderStatus ||
//       "UNKNOWN";

//     // 🔹 Extract payment attempts if available
//     const paymentDetails = response?.paymentDetails || response?.data?.paymentDetails || [];

//     // 🔹 Map to internal DB-friendly status
//     const dbStatus =
//       state === "COMPLETED"
//         ? "SUCCESS"
//         : state === "FAILED"
//         ? "FAILED"
//         : state === "PENDING"
//         ? "PENDING"
//         : "UNKNOWN";

//     // 🔹 Build normalized output
//     const normalized = {
//       merchant_order_id: merchantOrderId,
//       order_id: response?.orderId || null,
//       state,
//       dbStatus,
//       paymentDetails,
//       raw: response, // full raw payload for backup / logs
//     };

//     logger.info(`[PhonePe] Status for ${merchantOrderId}: ${dbStatus}`);

//     return normalized;
//   } catch (err) {
//     // 🔹 Improved error handling
//     logger.error(`[PhonePe] Status check failed for ${merchantOrderId}: ${err.message}`);
//     if (process.env.NODE_ENV !== "production") {
//       logger.error(err);
//     }

//     // Re-throw with a safe message
//     throw new Error(
//       err?.response?.data?.message ||
//         err?.message ||
//         "Unable to fetch order status from PhonePe."
//     );
//   }
// }

// async function checkOrderStatusWithRetry(merchantOrderId, details = false, retries = 2) {
//   try {
//     return await checkOrderStatus(merchantOrderId, details);
//   } catch (err) {
//     if (retries > 0) {
//       logger.warn(`[Retry] Retrying status check for ${merchantOrderId}...`);
//       await new Promise((r) => setTimeout(r, 1500)); // wait 1.5 sec
//       return await checkOrderStatusWithRetry(merchantOrderId, details, retries - 1);
//     }
//     throw err;
//   }
// }


// /**
//  * Verify callback signature
//  */
// function verifyCallbackSignature(username, password, authorizationHeader, bodyString) {
//   try {
//     const callbackResponse = phonePeClient.validateCallback(
//       username,
//       password,
//       authorizationHeader,
//       bodyString
//     );
//     logger.info("Callback verification result:", callbackResponse);
//     return callbackResponse;
//   } catch (err) {
//     logger.error("Callback verification failed:", err);
//     return false;
//   }
// }

// async function fetchOrderStatusAndUpdateDB(merchantOrderId) {
//   if (!merchantOrderId) throw new Error("merchantOrderId required");
//   logger.info("Fetching PhonePe order status for:", merchantOrderId);

//   const response = await phonePeClient.getOrderStatus(merchantOrderId, false);
//   logger.info("PhonePe Order Status Response:", response.expireAt, response.state, response.orderId);

//   const { state, orderId, payment_details = [] } = response;
//   const latestPayment = payment_details[0] || {};

//   let status;
//   if (state === "COMPLETED" || latestPayment.state === "COMPLETED") status = "SUCCESS";
//   else if (state === "FAILED" || latestPayment.state === "FAILED") status = "FAILED";
//   else status = "PENDING";

//   // Get payment from DB
//   const [paymentRow] = await pool.query(
//     `SELECT * FROM payments WHERE merchant_order_id = ?`,
//     [merchantOrderId]
//   );
//   const payment = paymentRow[0];
//   logger.info("Payment from DB:", payment);
//   if (!payment) throw new Error("Payment not found in DB");

//   // Update payment
//   await pool.query(
//     `UPDATE payments SET 
//        transaction_id = ?, 
//        status = ?, 
//        payment_reference = ?, 
//        payment_response = ?, 
//        updated_at = NOW() 
//      WHERE payment_id = ?`,
//     [
//       latestPayment.transactionId || orderId,
//       status,
//       latestPayment.paymentId || null,
//       JSON.stringify(response),
//       payment.payment_id,
//     ]
//   );

//   // Update order status
//   const orderStatus = status === "SUCCESS" ? "CONFIRMED" : (status === "FAILED" ? "CANCELLED" : "PENDING");
//   await pool.query(`UPDATE orders SET order_status = ? WHERE order_id = ?`, [orderStatus, payment.order_id]);

//   return { status, payment, orderId };
// }


// /**
//  * Initiate Refund
//  */
// async function refundPayment(originalMerchantOrderId, refundAmount) {
//   const merchantRefundId = `REFUND_${Date.now()}`;
//   const amountPaise = Math.round(refundAmount * 100);

//   const request = RefundRequest.builder()
//     .merchantRefundId(merchantRefundId)
//     .originalMerchantOrderId(originalMerchantOrderId)
//     .amount(amountPaise)
//     .build();

//   try {
//     const response = await phonePeClient.refund(request);
//     return response;
//   } catch (err) {
//     logger.error("Refund error:", err);
//     throw new Error(err?.message || "Refund failed");
//   }
// }

// module.exports = {
//   initiatePayment,
//   createSdkOrder,
//   checkOrderStatus, // <-- New function added here
//   verifyCallbackSignature,
//   fetchOrderStatusAndUpdateDB,
//   refundPayment,
//   checkOrderStatusWithRetry 
// };
