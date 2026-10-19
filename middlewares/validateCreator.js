const logger = require("../utils/logger");
const db = require('../config/db'); // adjust path as needed

const validateCreator = (req, res, next) => {
  let { created_by } = req.body;

  // If not provided in body, try to use from authenticated user
  if (!created_by && req.user && req.user.special_id) {
    created_by = req.user.special_id;
    req.body.created_by = created_by; // attach it to body for later use
  }

  // Still missing? Respond with error
  if (!created_by) {
    return res.status(400).json({ message: "'created_by' (special_id) is required." });
  }

  const sql = 'SELECT * FROM users WHERE special_id = ?';
  db.query(sql, [created_by], (err, results) => {
    if (err) {
      logger.error('DB error validating creator:', err);
      return res.status(500).json({ message: 'Database error while validating creator.', error: err.message });
    }

    if (results.length === 0) {
      return res.status(400).json({ message: `Creator with special_id '${created_by}' does not exist.` });
    }

    // Valid creator found
    next();
  });
};

module.exports = validateCreator;
