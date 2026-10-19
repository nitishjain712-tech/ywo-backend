require("dotenv").config();

function getGateway() {
  const gateway = process.env.ACTIVE_PAYMENT_GATEWAY;

  if (gateway === "PhonePe") return require("./phonepeService");
  if (gateway === "Razorpay") return require("./razorpayService");

  throw new Error("Invalid ACTIVE_PAYMENT_GATEWAY");
}

module.exports = { getGateway };