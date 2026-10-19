const phonepeService = require("./phonepeService");
const razorpayService = require("./razorpayService");

function getGateway() {
  const gateway = process.env.ACTIVE_PAYMENT_GATEWAY;

  if (gateway === "PhonePe") return phonepeService;
  if (gateway === "Razorpay") return razorpayService;

  throw new Error("Invalid ACTIVE_PAYMENT_GATEWAY");
}

module.exports = { getGateway };