const logger = require("../utils/logger");
const nodemailer = require("nodemailer");

/* -------------------------------------------------
   🔌 SMTP TRANSPORT (ORDER EMAIL ONLY)
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
    logger.error("❌ [ORDER EMAIL] SMTP failed:", err.message);
  } else {
    logger.info("✅ [ORDER EMAIL] SMTP ready");
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

function getMailMeta(eventType, paymentMethod) {
  if (eventType === "ORDER_PLACED") {
    return {
      subject:
        paymentMethod === "COD"
          ? "🛒 Order Placed (Cash on Delivery)"
          : "🛒 Order Placed Successfully",
      heading: "Your order has been placed successfully 🎉",
      message:
        paymentMethod === "COD"
          ? "You chose Cash on Delivery. Please keep the amount ready at delivery."
          : "Your payment was successful and your order is confirmed."
    };
  }

  if (eventType === "PAYMENT_FAILED") {
    return {
      subject: "Payment Failed – Order Cancelled",
      heading: "Payment Failed",
      message:
        "Unfortunately, your payment could not be completed. The order has been cancelled and no amount has been deducted. Please try placing the order again at ywo.com."
    };
  }

  throw new Error(`Invalid order email event type: ${eventType}`);
}


/* -------------------------------------------------
   📩 MAIN SERVICE
-------------------------------------------------- */
exports.sendOrderEmail = async ({
  eventType,
  order,
  items,
  user
}) => {
  logger.info("📧 [ORDER EMAIL] Triggered:", {
    order_id: order?.order_id,
    to: user?.email
  });

  if (!user?.email) {
    logger.warn("⚠️ [ORDER EMAIL] No recipient email, skipping.");
    return;
  }

  const { subject, heading, message } = getMailMeta(
    eventType,
    order.payment_method
  );

  const itemsTable = buildOrderItemsTable(items);

  // Charges
  const shippingCharge = Number(order.total_shipping_price || 0);
  const codCharge = Number(order.cod_charge || 0);
  const itemsTotal = Number(order.total_amount || 0);

  const frontendUrl = process.env.FRONTEND_URL || "https://ywo.com";
  const orderRedirectUrl = `${frontendUrl}/my-orders`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:auto;">
      <h2>${heading}</h2>

      <p>Hi <b>${user.name || "Customer"}</b>,</p>
      <p>${message}</p>

      <hr />

      <h3>Order Summary</h3>
      <p><b>Order ID:</b> ${order.order_id}</p>
      <p><b>Payment Method:</b> ${order.payment_method}</p>
      <p><b>Order Status:</b> ${order.order_status}</p>

      ${itemsTable}

      <table width="100%" style="margin-top:15px;">
        
        <tr>
          <td align="right">Shipping Charge:</td>
          <td align="right">₹${shippingCharge}</td>
        </tr>
        ${
          order.payment_method === "COD"
            ? `
        <tr>
          <td align="right">COD Charge:</td>
          <td align="right">₹${codCharge}</td>
        </tr>
        `
            : ""
        }
        <tr style="font-weight:bold;border-top:1px solid #ddd;">
          <td align="right">Total Payable:</td>
          <td align="right">
            ₹${itemsTotal}
          </td>
        </tr>
      </table>

      <div style="text-align:center;margin:30px 0;">
        <a href="${orderRedirectUrl}"
           style="background:#000;color:#fff;padding:12px 24px;
           text-decoration:none;border-radius:6px;display:inline-block;">
          View My Orders
        </a>
      </div>

      <hr />
      <p>If you have any questions, feel free to contact our support team at info@ywo.com or sales@ywo.com, You can also reach us on WhatsApp or Phone call at +91 7314245858 or +91 9522582422.</p>
      <p>Thank you for shopping with Yuva Western Outfit ❤️</p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: process.env.ORDER_EMAIL_FROM,
      to: user.email,
      subject,
      html
    });

    logger.info("✅ [ORDER EMAIL] Sent:", {
      order_id: order.order_id,
      messageId: info.messageId
    });
  } catch (err) {
    logger.error("❌ [ORDER EMAIL] Failed:", err.message);
  }
};
