const logger = require("../utils/logger");
const { fetchSalesReport, REPORT_COLUMNS } = require("../models/reportModel");

// Convert DB rows to TXT (TSV)
function generateTXT(rows) {
  let text = REPORT_COLUMNS.join("\t") + "\n";

  rows.forEach(r => {
    const row = REPORT_COLUMNS.map(col =>
      (r[col] ?? "")
        .toString()
        .replace(/\t/g, " ")  // prevent tab break
        .replace(/\n/g, " ")  // prevent line break
        .replace(/\r/g, " ")  // prevent carriage return
    );
    text += row.join("\t") + "\n";
  });

  return text;
}

exports.downloadSalesReport = async (req, res) => {
  try {
    let { start, end } = req.query;

    // ----------- DATE VALIDATION -----------
    if (start && end) {
      if (isNaN(Date.parse(start)) || isNaN(Date.parse(end))) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format. Use YYYY-MM-DD"
        });
      }

      if (new Date(start) > new Date(end)) {
        return res.status(400).json({
          success: false,
          message: "Start date cannot be greater than end date"
        });
      }
    }

    // ----------- FETCH REPORT -----------
    const rows = await fetchSalesReport(start, end);

    // ----------- HANDLE EMPTY RESULTS -----------
    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No records found for selected date range"
      });
    }

    // ----------- GENERATE TXT FILE -----------
    const txtContent = generateTXT(rows);
    const filename = `sales-report-${new Date().toISOString().slice(0, 10)}.txt`;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    return res.status(200).send(txtContent);

  } catch (error) {
    logger.error("\n❌ Sales Report Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to generate sales report",
      error: error.message
    });
  }
};
