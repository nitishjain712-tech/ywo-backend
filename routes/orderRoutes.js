const express = require("express");
const authenticate = require("../middlewares/authenticate");
const adminAuth = require("../middlewares/adminAuth");
const orderController = require("../controllers/orderController");

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// Customer-facing routes
router.post(
  "/preview",
  authenticate,
  asyncHandler(orderController.previewOrder)
);
router.post(
  "/place-order",
  authenticate,
  asyncHandler(orderController.placeOrder)
);
router.get(
  "/my-orders",
  authenticate,
  asyncHandler(orderController.getUserOrders)
);
// Admin order management
router.patch(
  "/:orderId/status",
  adminAuth,
  asyncHandler(orderController.adminUpdateOrderStatus)
);
router.put(
  "/:orderId/mark-shipped",
  adminAuth,
  asyncHandler(orderController.markOrderAsShipped)
);

router.put(
  "/:orderId/mark-delivered",
  adminAuth,
  asyncHandler(orderController.markOrderAsDelivered)
);


router.post(
  "/admin/cancel",
  adminAuth,
  asyncHandler(orderController.adminCancelOrder)
);

router.post(
  "/admin/refund",
   adminAuth,
  asyncHandler(orderController.adminRecordRefund)
)


// router.post(
//   "/admin/confirm-return",
//   adminAuth,
//   asyncHandler(orderController.adminConfirmReturn)
// );
router.post(
  "/admin/return",
  adminAuth,
  asyncHandler(orderController.adminReturnOrder)
);

router.post(
  "/admin/refund-for-return",
  adminAuth,
  asyncHandler(orderController.adminRecordRefundForReturn)
);

router.get(
  "/get-all-orders",
  adminAuth,
  asyncHandler(orderController.adminListOrders)
);
router.get(
  "/get-all-pending-orders",
  adminAuth,
  asyncHandler(orderController.adminListPendingOrders)
);
router.get(
  "/get-all-confirmed-orders",
  adminAuth,
  asyncHandler(orderController.adminListConfirmedOrders)
);
router.get(
  "/get-all-return-request-orders",
  adminAuth,
  asyncHandler(orderController.adminListReturnRequestOrders)
);
router.get(
  "/get-all-partially-returned-orders",
  adminAuth,
  asyncHandler(orderController.adminListPartiallyReturnedOrders)
);
router.get(
  "/get-all-partially-cancelled-orders",
  adminAuth,
  asyncHandler(orderController.adminListPartiallyCancelledOrders)
);
router.get(
  "/get-all-refunded-orders",
  adminAuth,
  asyncHandler(orderController.adminListRefundedOrders)
);
router.get(
  "/get-all-partially-refunded-orders",
  adminAuth,
  asyncHandler(orderController.adminListPartiallyRefundedOrders)
);
router.get(
  "/get-all-shipped-orders",
  adminAuth,
  asyncHandler(orderController.adminListShippedOrders)
);
router.get(
  "/get-all-delivered-orders",
  adminAuth,
  asyncHandler(orderController.adminListDeliveredOrders)
);
router.get(
  "/get-all-returned-orders",
  adminAuth,
  asyncHandler(orderController.adminListReturnedOrders)
);
router.get(
  "/get-all-cancelled-orders",
  adminAuth,
  asyncHandler(orderController.adminListCancelledOrders)
);

router.get(
  "/:orderId",
  authenticate,
  asyncHandler(orderController.getOrder)
);

module.exports = router;


