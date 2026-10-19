const logger = require('../utils/logger');

const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent') || 'unknown'
    };

    // Log user id if authenticated
    if (req.user && req.user.id) {
      logData.userId = req.user.id;
    }

    if (res.statusCode >= 400) {
      logger.error(`[HTTP] ${req.method} ${req.url} failed with status ${res.statusCode}`, logData);
    } else {
      logger.info(`[HTTP] ${req.method} ${req.url} completed in ${duration}ms`, logData);
    }
  });

  next();
};

module.exports = requestLogger;
