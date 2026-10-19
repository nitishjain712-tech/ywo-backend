const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // ✅ FIXED
  },
});

exports.sendOTPEmail = async (email, otp, adminName) => {
  const mailOptions = {
    from: `"Yuva Western Outfit Admin" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "🔐 Your Admin Login OTP - Yuva Western Outfit",
    html: `
      <p>Hello <b>${adminName}</b>,</p>
      <p>Your OTP is:</p>
      <h2 style="letter-spacing:4px">${otp}</h2>
      <p>This OTP is valid for <b>10 minutes</b>.</p>
      <p>If you did not request this, ignore this email.</p>
    `,
  };

  await transporter.sendMail(mailOptions);
};
