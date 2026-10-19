const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const path = require('path');
require('dotenv').config();
require("./cron/cleanupExpiredOtps");
require("./cron/cleanupAdminUpdateOtps");

if(process.env.ACTIVE_PAYMENT_GATEWAY === "PhonePe") {
  require("./services/paymentStatusChecker");
}

// ✅ Import Routes
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const userRoutes = require('./routes/userRoutes');
const categoryRoutes = require('./routes/categoryRoutes'); // 🟢 Add categories
const cartRoutes = require("./routes/cartRoutes");
const bannerRoutes = require("./routes/bannerRoutes");
const couponRoutes = require("./routes/couponRoutes");
const dealRoutes = require("./routes/dealRoutes");
const orderRoutes = require("./routes/orderRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const shippingRoutes = require("./routes/shippingRoutes");
const adminRoutes = require("./routes/adminRoutes");
const adminReviewRoutes = require("./routes/adminReviewRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const chargeRoutes = require("./routes/chargeRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const shippingLabelRoutes = require("./routes/shippingLabelRoutes");
const shippingPolicyRoutes = require("./routes/shippingPolicyRoutes");
const privacyPolicyRoutes = require("./routes/privacyPolicyRoutes");
const termsConditionsRoutes = require("./routes/termsConditionsRoutes");
const faqRoutes = require("./routes/faqRoutes");
const refundPolicyRoutes = require("./routes/refundPolicyRoutes");
const estimatedDeliveryRoutes = require("./routes/estimatedDeliveryDateRoutes");
const extraDeliveryChargeRoutes = require("./routes/extraDeliveryChargeRoutes");
const codSettingsRoutes = require("./routes/codSettingsRoutes");
const reportRoutes = require("./routes/reportRoutes");

const errorHandler = require('./middlewares/errorHandler'); // 🟢 Central error handler
const requestLogger = require('./middlewares/requestLogger'); // 🟢 Central request logger


// App Init
const app = express();

// Trust proxy (if using reverse proxy like Nginx)
app.set('trust proxy', 1);

// ✅ Security headers
app.use(helmet());

// ✅ CORS (adjust origin as needed)
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',');

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true
}));

// ✅ CORP (for images and static resources)
app.use((req, res, next) => {
res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});

// ✅ Log all incoming requests and outcomes
app.use(requestLogger);

// ✅ Rate limiting
const limiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 15 minutes
  max: 5500, // limit each IP to 200 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use(
  "/api/payment/webhook",
  express.raw({ type: "application/json" })
);

// ✅ Body parser and compression
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));
app.use(compression());



// ✅ Serve uploaded images statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use("/shipping_labels", express.static(path.join(__dirname, "shipping_labels")));
app.use("/invoices", express.static(path.join(__dirname, "invoices")));
app.use("/shipping_zips", express.static(path.join(__dirname, "shipping_zips")));




// ✅ Mount routes
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes); // Auth API
app.use('/api/products', productRoutes);
app.use('/api/users', userRoutes); // User API
app.use('/api/categories', categoryRoutes); // Categories API
app.use('/api/cart', cartRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/deals', dealRoutes);
app.use("/api/orders", orderRoutes);     // order routes
app.use("/api/payment", paymentRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/admin/reviews", adminReviewRoutes);
app.use("/api/admin/charges", chargeRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/shipping/labels", shippingLabelRoutes); // all label routes start with /api
app.use("/api/shipping-policies", shippingPolicyRoutes);
app.use("/api/privacy-policies", privacyPolicyRoutes);
app.use("/api/terms-conditions", termsConditionsRoutes);
app.use("/api/faqs", faqRoutes);
app.use("/api/refund-policies", refundPolicyRoutes);
app.use("/api/estimated-delivery-dates", estimatedDeliveryRoutes);
app.use("/api/extra-delivery-charges", extraDeliveryChargeRoutes);
app.use("/api/cod-settings", codSettingsRoutes);
app.use("/api/reports", reportRoutes);
  // payment routes

// ✅ Health Check Route
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running smoothly 🚀' });
});



// ✅ 404 Not Found handler
app.use((req, res, next) => {
  res.status(404).json({ message: 'Route not found' });
});

// ✅ Global error handler (last middleware)
app.use(errorHandler);

// ✅ Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const logger = require("./utils/logger");
  logger.info(`✅ Server running on port ${PORT}`);
  console.log(`✅ Server running on port ${PORT}`);
});

