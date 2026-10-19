const logger = require("../utils/logger");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const { jsPDF } = require("jspdf");
require("jspdf-autotable");
const pool = require("../config/db");

// =============== 🔹 Helper Function: Generate One Shipping Label PDF ===============
async function createShippingLabel(order_id) {
  // 🟢 Check if label already exists
  const dir = path.join(__dirname, "../shipping_labels");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `shipping_label_${order_id}.pdf`);

  if (fs.existsSync(filePath)) {
    logger.info(`✅ Label for order ${order_id} already exists, skipping generation.`);
    return filePath;
  }

  // 🟢 1. Get order details
  const [orderRows] = await pool.query(
    `
    SELECT 
      o.order_id,
      o.created_at AS order_date,
      o.total_amount,
      o.shipping_name,
      o.shipping_phone,
      o.shipping_street,
      o.shipping_city,
      o.shipping_state,
      o.shipping_zip,
      o.shipping_country,
      o.gst_number
    FROM orders o
    WHERE o.order_id = ?
    `,
    [order_id]
  );

  if (orderRows.length === 0) throw new Error("Order not found");
  const order = orderRows[0];

  // 🟢 2. Payment details
  const [paymentRows] = await pool.query(
    `SELECT payment_method, amount FROM payments WHERE order_id = ?`,
    [order_id]
  );
  const payment = paymentRows[0] || {};

  // 🟢 3. Get active SKUs + Qty (exclude cancelled/refunded/returned)
const [items] = await pool.query(
  `
  SELECT pv.sku, oi.quantity
  FROM order_items oi
  JOIN product_variants pv ON oi.variant_id = pv.id
  WHERE oi.order_id = ?
    AND oi.item_status NOT IN ('CANCELLED', 'RETURNED', 'REFUNDED', 'RETURN_REQUESTED')
  `,
  [order_id]
);

// 🚫 No items to ship? Stop here!
if (items.length === 0) {
  throw new Error("No shippable items left in this order.");
}


  // 🧮 PDF Setup (4x6 inch)
  const width = 432;
  const height = 288;

  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: [width, height],
  });

  // Draw page function
  const drawPage = (pageItems, pageNum, totalPages) => {
    if (pageNum > 1) doc.addPage();

    doc.setDrawColor(0);
    doc.setLineDash([3]);
    doc.rect(20, 20, width - 40, height - 40);
    doc.line(width / 2, 25, width / 2, height - 25);

    // LEFT SIDE
    let leftX = 35;
    let y = 45;
    doc.setFont("helvetica", "bold").setFontSize(10);
    doc.text("Ship To", leftX, y);

    doc.setFontSize(8.5);
    doc.text(order.shipping_name?.toUpperCase() || "-", leftX, (y += 16));

    const shippingAddr = `${order.shipping_street || ""}\n${(order.shipping_city || "").toUpperCase()} ${order.shipping_zip || ""} ${(order.shipping_state || "").toUpperCase()}, ${(order.shipping_country || "").toUpperCase()}`;
    const shippingLines = doc.splitTextToSize(shippingAddr, 160);
    doc.text(shippingLines, leftX, (y += 12));
    y += shippingLines.length * 10 + 8;

    doc.setFont("helvetica", "bold");
    doc.text("GSTIN:", leftX, y);
    doc.text(order.gst_number || "-", leftX + 50, y);

    doc.text("Phone:", leftX, (y += 12));
    doc.text(order.shipping_phone || "-", leftX + 50, y);

    // SKU List
    y += 17;
    doc.text("SKU(s):", leftX, y);
    doc.setFont("helvetica", "bold").setFontSize(9);

pageItems.forEach((item) => {
  const skuLine = `- ${item.sku} (Qty: ${item.quantity})`;

  // Wrap long text
  const wrappedLines = doc.splitTextToSize(skuLine, 160); // width = 160px

  wrappedLines.forEach((line) => {
    y += 12;
    if (y < height - 30) {
      doc.text(line, leftX + 15, y);
    }
  });
});

    // RIGHT SIDE
    let rx = width / 2 + 20;
    y = 45;

    doc.setFont("helvetica", "bold").setFontSize(9);
    doc.text("ORDER NO.:", rx, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(order.order_id), rx + 90, y);

    doc.setFont("helvetica", "bold");
    doc.text("ORDER DATE:", rx, (y += 12));
    doc.setFont("helvetica", "normal");
    doc.text(new Date(order.order_date).toLocaleDateString(), rx + 90, y);

    doc.setFont("helvetica", "bold");
    doc.text("Payment:", rx, (y += 12));
    doc.setFont("helvetica", "normal");
    doc.text(payment.payment_method === "COD" ? "COD" : "PREPAID", rx + 90, y);

    doc.setFont("helvetica", "bold");
    doc.text("ORDER TOTAL:", rx, (y += 12));
    doc.setFont("helvetica", "normal");
    doc.text(`Rs. ${order.total_amount || 0}`, rx + 90, y);

    y += 25;
    doc.setFont("helvetica", "bold").setFontSize(10);
    doc.text("YUVA WESTERN OUTFIT STORE", rx, y);

    const storeAddress = `C/o YUVA WESTERN OUTFIT
1A, BALAJI MARKET, HAWA BANGLA ROAD, 
KUNDAN NAGAR INDORE-452013 (MP)`;
    const storeLines = doc.splitTextToSize(storeAddress, 180);
    doc.setFont("helvetica", "normal").setFontSize(8.5);
    doc.text(storeLines, rx, (y += 15));

    const endY = y + storeLines.length * 10;
    doc.setFont("helvetica", "bold").setFontSize(8.5);
    doc.text("Telephone: 07314245858", rx, endY + 12);
    doc.text("Phone: +91-95225 82422", rx, endY + 24);
    doc.text("Email: ywo@gmail.com", rx, endY + 50);

    if (totalPages > 1) {
      doc.setFontSize(7).setFont("helvetica", "italic");
      doc.text(`Page ${pageNum} of ${totalPages}`, width - 80, height - 15);
    }
  };

  // Pagination
  const chunkSize = 8;
  const totalPages = Math.ceil(items.length / chunkSize) || 1;
  for (let i = 0; i < totalPages; i++) {
    const pageItems = items.slice(i * chunkSize, (i + 1) * chunkSize);
    drawPage(pageItems, i + 1, totalPages);
  }

  // Save PDF
  doc.save(filePath);
  return filePath;
}

// =============== 🔹 SINGLE LABEL ===============
exports.generateSingleShippingLabel = async (req, res) => {
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ message: "order_id is required" });

  try {
    const dir = path.join(__dirname, "../shipping_labels");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `shipping_label_${order_id}.pdf`);

    // ✅ Check if label already exists
    if (fs.existsSync(filePath)) {
      return res.json({
        message: "✅ Shipping label already exists",
        file: `/shipping_labels/${path.basename(filePath)}`,
      });
    }

    // 🚀 Otherwise, generate a new one
    const generatedFilePath = await createShippingLabel(order_id);
    res.json({
      message: "✅ Shipping label generated successfully",
      file: `/shipping_labels/${path.basename(generatedFilePath)}`,
    });
  } catch (err) {
    logger.error("❌ Single label error:", err);
    res.status(500).json({ message: "Error generating label", error: err.message });
  }
};


// =============== 🔹 BULK LABELS (ZIP) ===============
exports.generateBulkShippingLabels = async (req, res) => {
  const { order_ids } = req.body;
  if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
    return res.status(400).json({ message: "order_ids array is required" });
  }

  try {
    const labelsDir = path.join(__dirname, "../shipping_labels");
    const zipDir = path.join(__dirname, "../shipping_zips");

    if (!fs.existsSync(labelsDir)) fs.mkdirSync(labelsDir, { recursive: true });
    if (!fs.existsSync(zipDir)) fs.mkdirSync(zipDir, { recursive: true });

    const zipName = `shipping_labels_${order_ids.join("_")}.zip`;
    const zipPath = path.join(zipDir, zipName);

    // ✅ If ZIP already exists, return it immediately
    if (fs.existsSync(zipPath)) {
      logger.info(`✅ ZIP for ${order_ids.length} orders already exists.`);
      return res.json({
        message: "✅ Bulk shipping labels ZIP already exists",
        file: `/shipping_zips/${zipName}`,
      });
    }

    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(output);

    // ✅ Check each label file before generating
    for (const id of order_ids) {
      try {
        const labelPath = path.join(labelsDir, `shipping_label_${id}.pdf`);

        // 🟢 If label already exists, use it
        if (fs.existsSync(labelPath)) {
          logger.info(`✅ Label already exists for order ${id}`);
          archive.file(labelPath, { name: path.basename(labelPath) });
        } else {
          // 🚀 Otherwise, generate new label
          const newLabelPath = await createShippingLabel(id);
          archive.file(newLabelPath, { name: path.basename(newLabelPath) });
        }
      } catch (err) {
        logger.warn(`⚠️ Skipping order ${id}: ${err.message}`);
      }
    }

    archive.finalize();

    output.on("close", () => {
      res.json({
        message: "✅ Bulk shipping labels ZIP generated successfully",
        file: `/shipping_zips/${zipName}`,
      });
    });

    output.on("error", (err) => {
      logger.error("❌ ZIP creation error:", err);
      res.status(500).json({
        message: "Error while creating ZIP file",
        error: err.message,
      });
    });

  } catch (err) {
    logger.error("❌ Bulk label error:", err);
    res.status(500).json({
      message: "Error generating bulk shipping labels",
      error: err.message,
    });
  }
};

