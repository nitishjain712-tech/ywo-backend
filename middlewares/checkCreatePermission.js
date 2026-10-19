const logger = require("../utils/logger");
const db = require('../config/db');

const allowedCreation = {
  admin: ['admin', 'manager', 'franchaisee', 'client'],
  manager: ['franchaisee', 'client'],
  franchaisee: ['client']
};

const checkCreatePermission = (req, res, next) => {
  const creatorId = req.user.special_id;
  const targetRole = req.body.role?.toLowerCase();

  if (!targetRole) {
    return res.status(400).json({ message: 'Missing target role in request body.' });
  }

  const fetchRoleSql = `SELECT role FROM users WHERE special_id = ? LIMIT 1`;
  db.query(fetchRoleSql, [creatorId], (err, result) => {
    if (err) {
      logger.error('DB error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (result.length === 0) {
      return res.status(404).json({ message: 'Creator not found' });
    }

    const creatorRole = result[0].role.toLowerCase();

    const allowedRoles = allowedCreation[creatorRole];
    if (!allowedRoles) {
      return res.status(403).json({ message: `Unauthorized creator role: '${creatorRole}'` });
    }

    if (!allowedRoles.includes(targetRole)) {
      return res.status(403).json({
        message: `Permission denied: ${creatorRole} cannot create user with role '${targetRole}'`
      });
    }

    next(); // ✅ Allowed
  });
};

module.exports = checkCreatePermission;
