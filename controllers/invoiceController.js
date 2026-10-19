const logger = require("../utils/logger");
const { jsPDF } = require("jspdf");
require("jspdf-autotable");
const pool = require("../config/db");
const path = require("path");
const fs = require("fs");


async function generateInvoiceNumber(conn) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // Financial Year (FY)
  const fy =
    month >= 4
      ? `${String(year).slice(2)}-${String(year + 1).slice(2)}`
      : `${String(year - 1).slice(2)}-${String(year).slice(2)}`;

  // Get last invoice of this FY
  const [rows] = await conn.query(
    "SELECT invoice_number FROM orders WHERE invoice_number LIKE ? ORDER BY order_id DESC LIMIT 1",
    [`INV/${fy}/%`]
  );

  let nextNumber = "00001";
  if (rows.length > 0) {
    const last = rows[0].invoice_number;
    const lastNum = parseInt(last.split("/")[2]);
    nextNumber = String(lastNum + 1).padStart(5, "0");
  }

  return { invoiceNumber: `INV/${fy}/${nextNumber}`, fy };
}


// 🧾 Generate Invoice PDF
exports.generateInvoice = async (req, res) => {
  const { order_id, user_id } = req.body;
  if (!order_id || !user_id)
    return res.status(400).json({ message: "order_id and user_id are required" });

  const conn = await pool.getConnection();
  try {
    const invoiceDir = path.join(__dirname, "../invoices");
    if (!fs.existsSync(invoiceDir)) fs.mkdirSync(invoiceDir, { recursive: true });

    const invoicePath = path.join(invoiceDir, `invoice_${order_id}.pdf`);
    const invoiceUrl = `/invoices/invoice_${order_id}.pdf`;

    // ✅ 1️⃣ If invoice already exists, return it immediately
    if (fs.existsSync(invoicePath)) {
      logger.info(`✅ Invoice already exists for order ${order_id}`);
      return res.json({
        message: "✅ Invoice already exists",
        invoice_url: invoiceUrl,
        invoice_path: invoicePath,
      });
    }

    // --- 2️⃣ Fetch order details
    const [orderRows] = await conn.query(
      `SELECT o.order_id, o.total_amount, o.total_discount_amount,
              o.total_shipping_price, o.cod_charge, o.additional_charge, o.created_at,
              o.shipping_name, o.shipping_phone, o.shipping_street,
              o.shipping_city, o.shipping_state, o.shipping_zip, o.shipping_country,
              o.gst_number,
              u.name AS user_name, u.email
       FROM orders o
       JOIN users u ON o.user_id = u.id
       WHERE o.order_id = ? AND o.user_id = ?`,
      [order_id, user_id]
    );

    if (!orderRows.length)
      return res.status(404).json({ message: "Order not found for this user" });

    const order = orderRows[0];

let invoiceNumber; // <-- SINGLE variable

if (order.invoice_number) {
  invoiceNumber = order.invoice_number;   // use existing invoice
} else {
  const result = await generateInvoiceNumber(conn);
  invoiceNumber = result.invoiceNumber;   // new invoice number

  // Save new invoice in DB
  await conn.query(
    "UPDATE orders SET invoice_number = ?, invoice_date = NOW() WHERE order_id = ?",
    [invoiceNumber, order_id]
  );
}



    // --- 3️⃣ Fetch order items
    // const [items] = await conn.query(
    //   `SELECT p.name, p.gst_percent, pv.variant_name, pv.sku, pv.hsn_code,
    //           oi.quantity, oi.price, oi.subtotal
    //    FROM order_items oi
    //    JOIN products p ON p.id = oi.product_id
    //    LEFT JOIN product_variants pv ON pv.id = oi.variant_id
    //    WHERE oi.order_id = ?`,
    //   [order_id]
    // );


    const [items] = await conn.query(
  `SELECT p.name, p.gst_percent, pv.variant_name, pv.sku, pv.hsn_code,
          oi.quantity, oi.price, oi.subtotal, oi.item_status
   FROM order_items oi
   JOIN products p ON p.id = oi.product_id
   LEFT JOIN product_variants pv ON pv.id = oi.variant_id
   WHERE oi.order_id = ?
     AND oi.item_status NOT IN ('REFUNDED', 'CANCELLED')`,
  [order_id]
);


    if (!items.length)
      return res.status(404).json({ message: "No items found for this order" });

    // --- 4️⃣ Seller Info
    const seller = {
      name: "Yuva Western Outfit",
      address:
        "Shahda",
      phone: "+91 95225 82422",
      email: "ywo@gmail.com",
      gstin: "23BKBPS2369N1ZR",
      state: "Madhya Pradesh", // ✅ fixed seller state
    };

    // --- 5️⃣ GST Calculations (only this logic changed)
    let grossTotal = 0;
    let totalGST = 0;

    const isSameState = (order.shipping_state || "")
      .toLowerCase()
      .trim() === seller.state.toLowerCase().trim();

    const itemsWithGST = items.map((it) => {
      const qty = Number(it.quantity);
      const priceInclGST = Number(it.price); // unit price inclusive of GST
      const totalInclGST = priceInclGST * qty;
      const gstPercent = Number(it.gst_percent || 0);

      // Base (exclusive) total and total GST portion
      const basePriceTotal = totalInclGST / (1 + gstPercent / 100);
      const gstAmount = totalInclGST - basePriceTotal;

      // Split rates & amounts for display
      let taxRateDisplay = "";
      let taxTypeDisplay = "";
      let taxAmountDisplay = "";

      if (isSameState) {
        const halfRate = +(gstPercent / 2).toFixed(2);
        const cgstAmt = gstAmount / 2;
        const sgstAmt = gstAmount / 2;


        taxRateDisplay = `${gstPercent}%`;
        taxTypeDisplay = "CGST + SGST";
        // Option D: show percentages with each split amount
        taxAmountDisplay = `(${halfRate}%) ${Math.round(cgstAmt).toLocaleString("en-IN")} + (${halfRate}%) ${Math.round(sgstAmt).toLocaleString("en-IN")}`;
      } else {
        const igstRate = +gstPercent.toFixed(2);
        const igstAmt = gstAmount;

        taxRateDisplay = `${igstRate}%`;
        taxTypeDisplay = "IGST";
        // Option D formatting
        taxAmountDisplay = `(${igstRate}%) ${Math.round(igstAmt).toLocaleString("en-IN")}`;
      }

      grossTotal += totalInclGST;
      totalGST += gstAmount;

      return {
        ...it,
         hsn_code: it.hsn_code || null,
        qty,
        gstPercent,
        priceInclGST,
        basePriceTotal,
        gstAmount,
        totalInclGST,
        taxRateDisplay,
        taxTypeDisplay,
        taxAmountDisplay,
      };
    });

    const shippingCharge = parseFloat(order.total_shipping_price) || 0;
    const codCharge = parseFloat(order.cod_charge) || 0;
    const additionalCharge = parseFloat(order.additional_charge) || 0;
    const finalTotal = parseFloat(order.total_amount);

    // --- 6️⃣ Create PDF
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.width;

    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("TAX INVOICE", pageWidth / 2, 40, { align: "center" });

    // Seller Details
    const leftX = 40;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Sold By:", leftX, 70);
    doc.setFont("helvetica", "normal");
    doc.text(seller.name || "", leftX, 85);

    const addressText = doc.splitTextToSize(seller.address || "", 220); // ✅ wrapped address
    doc.text(addressText, leftX, 100);

    let currentY = 100 + addressText.length * 12; // dynamically move down based on wrapped lines
    doc.text(`Phone: ${seller.phone || "-"}`, leftX, currentY);
    doc.text(`Email: ${seller.email || "-"}`, leftX, currentY + 15);
    doc.text(`GSTIN: ${seller.gstin || "-"}`, leftX, currentY + 30);

    // Customer Details
    const rightX = pageWidth / 2 + 40;
    doc.setFont("helvetica", "bold");
    doc.text("Customer To:", rightX, 70);
    doc.setFont("helvetica", "normal");
    doc.text(order.shipping_name || "", rightX, 85);

    // ✅ wrap shipping street to avoid crash
    const wrappedShippingStreet = doc.splitTextToSize(order.shipping_street || "", 220);
    doc.text(wrappedShippingStreet, rightX, 100);

    let nextY = 100 + wrappedShippingStreet.length * 12;
    doc.text(
      `${order.shipping_city}, ${order.shipping_state} - ${order.shipping_zip}`,
      rightX,
      nextY
    );
    nextY += 15;

    doc.text(order.shipping_country || "India", rightX, nextY);
    nextY += 15;

    doc.text(`Phone: ${order.shipping_phone || ""}`, rightX, nextY);
    nextY += 15;

    if (order.gst_number) {
      doc.text(`GSTIN: ${order.gst_number}`, rightX, nextY);
    }

   // --- DYNAMIC POSITIONING FIX ---

// Calculate last Y position of both seller & customer sections
let sellerEndY = currentY + 30;
let customerEndY = nextY + 20;

// Whichever ends lower on the page → start next section below it
let sectionEndY = Math.max(sellerEndY, customerEndY);

// Invoice header starts AFTER customer/seller block
let invoiceInfoY = sectionEndY + 20;

doc.setFont("helvetica", "bold");
doc.text(`Invoice No: ${invoiceNumber}`, 40, invoiceInfoY);
doc.text(
  `Invoice Date: ${new Date(order.created_at).toLocaleDateString("en-IN")}`,
  40,
  invoiceInfoY + 15
);

// Table starts below invoice info dynamically
let startY = invoiceInfoY + 40;

    doc.autoTable({
      startY,
      head: [
        [
          "S. N.",
          "Description",
          "Unit Price",
          "Qty",
          "Net Amount",
          "Tax Rate",
          "Tax Type",
          "Tax Amount",
          "Total Amount",
        ],
      ],
     body: itemsWithGST.map((it, i) => [
  i + 1,
  `${it.name}${it.variant_name ? ` (${it.variant_name})` : ""}` +
  `\n${it.sku ? `(SKU: ${it.sku})` : ""}` +
  `${it.hsn_code ? `\n(HSN: ${it.hsn_code})` : ""}`,

  `Rs. ${it.priceInclGST.toLocaleString("en-IN")}`, // <-- comma is here ✔

  it.qty,
  `Rs. ${Math.round(it.basePriceTotal).toLocaleString("en-IN")}`,
  it.taxRateDisplay,
  it.taxTypeDisplay,
  it.taxAmountDisplay,
  `Rs. ${Math.round(it.totalInclGST).toLocaleString("en-IN")}`,
]),
      theme: "grid",
      headStyles: {
        fillColor: [230, 230, 230],
        textColor: 0,
        fontStyle: "bold",
        halign: "center",
      },
      bodyStyles: { valign: "middle", textColor: 20 },
      styles: {
        fontSize: 8,
        cellPadding: 2,
        lineWidth: 0.6,
        lineColor: [0, 0, 0],
      },
      columnStyles: {
        0: { cellWidth: 25, halign: "center" }, // Sl. No
        1: { cellWidth: 130 },                  // Description (slightly narrower to fit new columns)
        2: { cellWidth: 55, halign: "center" }, // Unit Price
        3: { cellWidth: 25, halign: "center" }, // Qty
        4: { cellWidth: 70, halign: "center" }, // Net Amount
        5: { cellWidth: 40, halign: "center" }, // Tax Rate (e.g. "9% + 9%")
        6: { cellWidth: 60, halign: "center" }, // Tax Type ("CGST + SGST" / "IGST")
        7: { cellWidth: 100, halign: "center" }, // Tax Amount ("(9%) 90 + (9%) 90")
        8: { cellWidth: 60, halign: "center" }, // Total Amount
      },
      tableWidth: "wrap",
      margin: { left: 15, right: 15 },
    });

    // --- Totals Section (unchanged)
    let totalY = doc.lastAutoTable.finalY + 20;
    const labelX = pageWidth - 270;
    const valueX = pageWidth - 40;
    const printRow = (label, value, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.text(label, labelX, totalY);
      doc.text(`RS. ${value.toFixed(2)}`, valueX, totalY, { align: "right" });
      totalY += 14;
    };

    printRow("GROSS TOTAL", grossTotal);
    printRow("COURIER CHARGES (Inc. of Tax)", shippingCharge);
    printRow("COD CHARGES (Inc. of Tax)", codCharge);
    printRow("ADDITIONAL CHARGES (Inc. of Tax)", additionalCharge);

    doc.setLineWidth(0.5);
    doc.line(labelX, totalY, valueX, totalY);
    totalY += 12;
    printRow("FINAL TOTAL", finalTotal, true);

    // --- Footer
    totalY += 30;
    doc.setFontSize(9);
    doc.text(
      "Thank you for shopping with Yuva Western Outfit! For any queries, contact yuvawesternoutfit@gmail.com",
      40,
      totalY
    );

    totalY += 20;
    const footerNote =
      "All disputes are subject to Madhya Pradesh jurisdiction only. Goods once sold will only be taken back or exchanged as per the company policy.";
    const wrappedFooter = doc.splitTextToSize(footerNote, 520);
    doc.text(wrappedFooter, 40, totalY);

    // --- Save PDF
    doc.save(invoicePath);

    res.json({
      message: "✅ Invoice generated successfully",
      invoice_url: invoiceUrl,
      invoice_path: invoicePath,
    });
  } catch (err) {
    logger.error("❌ generateInvoice failed:", err);
    res.status(500).json({ message: "Error generating invoice", error: err.message });
  } finally {
    conn.release();
  }
};
