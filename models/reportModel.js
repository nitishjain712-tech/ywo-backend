const logger = require("../utils/logger");
const pool = require("../config/db");

// FINAL EXPORT COLUMNS
const REPORT_COLUMNS = [
  "order_id",
  "order_item_id",
  "merchant_order_id",
  "purchase_date",
  "order_status",
  "item_status",

  "shipping_name",
  "shipping_phone",
  "shipping_street",
  "shipping_city",
  "shipping_state",
  "shipping_zip",
  "shipping_country",
  "gst_number",

  "product_name",
  "sku",
  "hsn_code",   
  "gst_rate",
  "gst_included",
  "quantity",

  "price",
  "subtotal",
  "item_discount",
  "shipping_price",
  "order_discount",
  "cod_charge",
  "additional_charge",
  "full_order_price",

  "payment_status",
  "amount",
  "refunded_total",
  "payment_method",
  "payment_gateway",
  "transaction_id",
  "payment_reference",

  "courier_name",
  "courier_tracking_id",
  "date_of_shipment"
];

// Convert MySQL datetime → DD-MM-YYYY HH:mm:ss
function formatIndianDate(mysqlDate) {
  if (!mysqlDate) return "N/A";

  const d = new Date(mysqlDate);
  if (isNaN(d)) return "N/A";

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");

  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

async function fetchSalesReport(startDate, endDate) {
  try {
    let dateFilter = "";
    const params = [];

    if (startDate && endDate) {
      if (isNaN(Date.parse(startDate)) || isNaN(Date.parse(endDate))) {
        throw new Error("Invalid date format. Use YYYY-MM-DD");
      }

      dateFilter = "WHERE o.created_at BETWEEN ? AND ?";
      params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
    }

    const sql = `
      SELECT
        o.order_id,

        -- MERGED ITEM FIELDS
        GROUP_CONCAT(oi.order_item_id) AS order_item_id,
        MAX(p.merchant_order_id) AS merchant_order_id,
        o.created_at AS purchase_date,

        MAX(o.order_status) AS order_status,
        GROUP_CONCAT(oi.item_status) AS item_status,

        -- CUSTOMER FIELDS
        MAX(o.shipping_name) AS shipping_name,
        MAX(o.shipping_phone) AS shipping_phone,
        MAX(o.shipping_street) AS shipping_street,
        MAX(o.shipping_city) AS shipping_city,
        MAX(o.shipping_state) AS shipping_state,
        MAX(o.shipping_zip) AS shipping_zip,
        MAX(o.shipping_country) AS shipping_country,
        MAX(o.gst_number) AS gst_number,

        -- PRODUCT & ITEM INFO
        GROUP_CONCAT(COALESCE(pv.variant_name, pr.name)) AS product_name,
        GROUP_CONCAT(COALESCE(pv.sku, '')) AS sku,
        GROUP_CONCAT(COALESCE(pv.hsn_code, '')) AS hsn_code,
        MAX(pr.gst_percent) AS gst_rate,
        'YES' AS gst_included,
        GROUP_CONCAT(oi.quantity) AS quantity,

        GROUP_CONCAT(oi.price) AS price,
        GROUP_CONCAT(oi.subtotal) AS subtotal,
        GROUP_CONCAT(oi.per_item_discount) AS item_discount,
        GROUP_CONCAT(oi.shipping_price) AS shipping_price,

        -- ORDER PRICING
        MAX(o.total_discount_amount) AS order_discount,
        MAX(o.cod_charge) AS cod_charge,
        MAX(o.additional_charge) AS additional_charge,
        MAX(o.total_amount) AS full_order_price,

        -- PAYMENT FIELDS
        MAX(p.status) AS payment_status,
        MAX(p.amount) AS amount,
        MAX(p.refunded_total) AS refunded_total,
        MAX(p.payment_method) AS payment_method,
        MAX(p.payment_gateway) AS payment_gateway,
        MAX(p.transaction_id) AS transaction_id,
        MAX(p.payment_reference) AS payment_reference,

        -- COURIER
        MAX(o.courier_name) AS courier_name,
        MAX(o.courier_tracking_id) AS courier_tracking_id,
        MAX(o.date_of_shipment) AS date_of_shipment

      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.order_id
      LEFT JOIN products pr ON oi.product_id = pr.id
      LEFT JOIN product_variants pv ON oi.variant_id = pv.id

      LEFT JOIN (
        SELECT p1.*
        FROM payments p1
        JOIN (
          SELECT order_id, MAX(created_at) AS max_time
          FROM payments
          GROUP BY order_id
        ) p2
        ON p1.order_id = p2.order_id AND p1.created_at = p2.max_time
      ) p ON p.order_id = o.order_id

      ${dateFilter}

      GROUP BY o.order_id
      ORDER BY o.created_at DESC;
    `;

    const [rows] = await pool.query(sql, params);

    if (!rows || rows.length === 0) return [];

    // Sanitize & format dates
    const cleanedRows = rows.map(row => {
      REPORT_COLUMNS.forEach(col => {
        const value = row[col];

        if (col === "purchase_date" || col === "date_of_shipment") {
          row[col] = formatIndianDate(value);
          return;
        }

        if (
          value === null ||
          value === undefined ||
          value === "" ||
          (typeof value === "string" && value.trim() === "")
        ) {
          row[col] = "N/A";
        }
      });

      return row;
    });

    return cleanedRows;

  } catch (error) {
    logger.error("fetchSalesReport Error:", error);
    throw new Error("Failed to fetch sales report: " + error.message);
  }
}

module.exports = { fetchSalesReport, REPORT_COLUMNS };