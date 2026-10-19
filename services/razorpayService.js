const Razorpay = require("razorpay");
const crypto = require("crypto");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const razorpayService = {

  async createOrder(orderId, amount) {
    const options = {
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `ORD_${orderId}_${Date.now()}`,
      payment_capture: 1,
    };

    return await razorpay.orders.create(options);
  },

  verifySignature(orderId, paymentId, signature) {
    const body = orderId + "|" + paymentId;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    return expectedSignature === signature;
  },

  async refundPayment(paymentId, amount) {
    return await razorpay.payments.refund(paymentId, {
      amount: Math.round(amount * 100),
    });
  }
};

module.exports = razorpayService;