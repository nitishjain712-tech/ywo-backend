const logger = require("../utils/logger");
const nodemailer = require("nodemailer");

/* -------------------------------------------------
   🔌 SMTP TRANSPORT (SHIPMENT EMAIL ONLY)
-------------------------------------------------- */
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

transporter.verify((err) => {
  if (err) {
    logger.error("❌ [SHIPMENT EMAIL] SMTP failed:", err.message);
  } else {
    logger.info("✅ [SHIPMENT EMAIL] SMTP ready");
  }
});

/* -------------------------------------------------
   🧾 HELPERS
-------------------------------------------------- */
function buildOrderItemsTable(items = []) {
  const rows = items.map(item => `
    <tr>
      <td>${item.product_name} (${item.variant_name})</td>
      <td align="center">${item.quantity}</td>
      <td align="right">₹${item.price}</td>
      <td align="right">₹${item.sub_total ?? item.subtotal}</td>
    </tr>
  `).join("");

  return `
    <table width="100%" cellpadding="8" cellspacing="0"
      style="border-collapse:collapse;border:1px solid #ddd;">
      <thead style="background:#f5f5f5;">
        <tr>
          <th align="left">Item</th>
          <th align="center">Qty</th>
          <th align="right">Price</th>
          <th align="right">Subtotal</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function getPaymentMessage(paymentMethod, totalAmount) {
  if (paymentMethod === "COD") {
    return `
      <p style="color:#b45309;">
        <b>Payment Reminder</b><br/>
        This order is <b>Cash on Delivery</b>.<br/>
        Please keep <b>₹${totalAmount}</b> ready at the time of delivery.
      </p>
    `;
  }

  return `
    <p style="color:#15803d;">
      <b>Payment Status</b><br/>
      Your payment of <b>₹${totalAmount}</b> has already been completed online.<br/>
      No payment is required at delivery.
    </p>
  `;
}

/* -------------------------------------------------
   📦 MAIN SHIPMENT EMAIL
-------------------------------------------------- */
exports.sendShipmentEmail = async ({
  order,
  items,
  courier
}) => {
  logger.info("📦 [SHIPMENT EMAIL] Triggered:", {
    order_id: order?.order_id,
    to: order?.shipping_email
  });

  if (!order?.shipping_email) {
    logger.warn("⚠️ [SHIPMENT EMAIL] No shipping_email, skipping.");
    return;
  }

  if (!items?.length) {
    logger.warn("⚠️ [SHIPMENT EMAIL] No shipped items, skipping.");
    return;
  }

  const itemsTable = buildOrderItemsTable(items);
  const paymentMessage = getPaymentMessage(
    order.payment_method,
    order.total_amount
  );

  const frontendUrl = process.env.FRONTEND_URL || "https://ywo.com";
  const orderRedirectUrl = `${frontendUrl}/my-orders`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:auto;">
      <h2>Your Order Has Been Shipped! 🚚</h2>

      <p>Hi <b>${order.shipping_name || "Customer"}</b>,</p>
      <p>Good news! Your order has been shipped and is on its way.</p>

      <hr />

      <h3>Shipment Details</h3>
      <p><b>Courier Partner:</b> ${courier.courier_name}</p>
      <p><b>Tracking ID:</b> ${courier.courier_tracking_id}</p>
      <p><b>Date of Shipment:</b> ${courier.date_of_shipment}</p>

      <hr />

      <h3>Order Summary</h3>
      <p><b>Order ID:</b> ${order.order_id}</p>

      ${itemsTable}

      <hr />

      ${paymentMessage}

      <div style="text-align:center;margin:30px 0;">
        <a href="${orderRedirectUrl}"
           style="background:#000;color:#fff;padding:12px 24px;
           text-decoration:none;border-radius:6px;display:inline-block;">
          Track My Order
        </a>
      </div>

      <hr />
      <p>If you have any questions, feel free to contact our support team at
      info@ywo.com or sales@ywo.com.</p>

      <p>Thank you for shopping with <b>Yuva Western Outfit</b> ❤️</p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: process.env.ORDER_EMAIL_FROM,
      to: order.shipping_email,
      subject: "Your Order Has Been Shipped 🚚",
      html
    });

    logger.info("✅ [SHIPMENT EMAIL] Sent:", {
      order_id: order.order_id,
      messageId: info.messageId
    });
  } catch (err) {
    logger.error("❌ [SHIPMENT EMAIL] Failed:", err.message);
  }
};
