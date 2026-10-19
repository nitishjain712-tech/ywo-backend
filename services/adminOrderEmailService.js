const logger = require("../utils/logger");
const nodemailer = require("nodemailer");

/* -------------------------------------------------
   🔐 SUPER ADMIN EMAIL (HARDCODED)
-------------------------------------------------- */
const SUPER_ADMIN_EMAIL = "nitishjain722@gmail.com";

/* -------------------------------------------------
   🔌 SMTP TRANSPORT
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

/* -------------------------------------------------
   📩 ADMIN ORDER EMAIL
-------------------------------------------------- */
exports.sendAdminNewOrderEmail = async ({ order, items, user }) => {
  logger.info("📧 [ADMIN EMAIL] Triggered:", {
    order_id: order?.order_id,
    to: SUPER_ADMIN_EMAIL
  });

  if (!order?.order_id) {
    logger.warn("⚠️ [ADMIN EMAIL] Invalid order data, skipping");
    return;
  }

  const rows = items.map(item => `
    <tr>
      <td>${item.product_name} (${item.variant_name})</td>
      <td align="center">${item.quantity}</td>
    </tr>
  `).join("");

  const adminPanelUrl =
    `${process.env.FRONTEND_URL}/admin/confirmed-orders`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:auto;">
      <h2>🆕 New Order Received</h2>

      <p><b>Order ID:</b> ${order.order_id}</p>
      <p><b>Customer:</b> ${user.name} (${user.email})</p>
      <p><b>Payment Method:</b> ${order.payment_method}</p>
      <p><b>Total Amount:</b> ₹${order.total_amount}</p>

      <h3>Items</h3>
      <table width="100%" border="1" cellpadding="6" cellspacing="0">
        <tr>
          <th align="left">Item</th>
          <th align="center">Qty</th>
        </tr>
        ${rows}
      </table>

      <div style="margin-top:20px;">
        👉 <a href="${adminPanelUrl}">
          View Order in Admin Panel
        </a>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: process.env.ORDER_EMAIL_FROM,
      to: SUPER_ADMIN_EMAIL,
      subject: `🆕 New Order #${order.order_id}`,
      html
    });

    logger.info("✅ [ADMIN EMAIL] Sent:", order.order_id);
  } catch (err) {
    logger.error("❌ [ADMIN EMAIL] Failed:", err.message);
  }
};
