const logger = require("../utils/logger");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ message: "Authorization token is missing or malformed" });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach needed user details from payload
    req.user = {
      id: decoded.id,            // ✅ numeric primary key for DB relations
      user_id: decoded.user_id,  // ✅ external readable ID (USR0001)
      email: decoded.email,
    };

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ message: "Token has expired. Please log in again." });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(403).json({ message: "Invalid token." });
    }

    logger.error("JWT verification error:", error);
    return res
      .status(500)
      .json({ message: "Internal Server Error during token validation." });
  }
};

module.exports = authenticate;
