const logger = require("../utils/logger");
const nodemailer = require("nodemailer");

/* -------------------------------------------------
   🔌 SMTP TRANSPORT (DELIVERY EMAIL ONLY)
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
    logger.error("❌ [DELIVERY EMAIL] SMTP failed:", err.message);
  } else {
    logger.info("✅ [DELIVERY EMAIL] SMTP ready");
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

/* -------------------------------------------------
   📬 MAIN DELIVERY EMAIL
-------------------------------------------------- */
exports.sendDeliveryEmail = async ({
  order,
  items
}) => {
  logger.info("📬 [DELIVERY EMAIL] Triggered:", {
    order_id: order?.order_id,
    to: order?.shipping_email
  });

  if (!order?.shipping_email) {
    logger.warn("⚠️ [DELIVERY EMAIL] No shipping_email, skipping.");
    return;
  }

  const itemsTable = buildOrderItemsTable(items);

  const frontendUrl = process.env.FRONTEND_URL || "https://waltzify.com";
  const orderRedirectUrl = `${frontendUrl}/my-orders`;

  // 💰 Payment message
  const paymentMessage =
    order.payment_method === "COD"
      ? "Thank you for completing the Cash on Delivery payment."
      : "Your payment was already completed online.";

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:auto;">
      <h2>Your Order Has Been Delivered!</h2>

      <p>Hi <b>${order.shipping_name || "Customer"}</b>,</p>
      <p>We’re happy to let you know that your order has been successfully delivered.</p>

      <p><b>${paymentMessage}</b></p>

      <hr />

      <h3>Delivered Items</h3>
      <p><b>Order ID:</b> ${order.order_id}</p>

      ${itemsTable}

      <p style="margin-top:15px;font-weight:bold;">
        Total Order Amount: ₹${order.total_amount}
      </p>

      <div style="text-align:center;margin:30px 0;">
        <a href="${orderRedirectUrl}"
           style="background:#000;color:#fff;padding:12px 24px;
           text-decoration:none;border-radius:6px;display:inline-block;">
          View My Orders
        </a>
      </div>

      <hr />
      <p>If you have any questions, feel free to contact our support team at
      ywo@gmail.com.</p>

      <p>Thank you for shopping with <b>YWO</b> ❤️</p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: process.env.ORDER_EMAIL_FROM,
      to: order.shipping_email,
      subject: "Your Order Has Been Delivered!",
      html
    });

    logger.info("✅ [DELIVERY EMAIL] Sent:", {
      order_id: order.order_id,
      messageId: info.messageId
    });
  } catch (err) {
    logger.error("❌ [DELIVERY EMAIL] Failed:", err.message);
  }
};
