const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/* ── Password Reset OTP ─────────────────────────────────────────────── */
const sendOTPEmail = async (toEmail, otp) => {
  const mailOptions = {
    from: `"Yuva Western Outfit" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "Password Reset OTP – Yuva Western Outfit",
    text: `Your OTP code is ${otp}. It will expire in 10 minutes.`,
    html: `<h2>Password Reset Request</h2>
           <p>Your OTP code is: <b>${otp}</b></p>
           <p>This code is valid for <b>10 minutes</b>.</p>`,
  };
  await transporter.sendMail(mailOptions);
};

/* ── Signup Email Verification OTP ─────────────────────────────────── */
const sendSignupVerificationEmail = async (toEmail, toName, otp) => {
  const mailOptions = {
    from: `"Yuva Western Outfit" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "Verify your email – Yuva Western Outfit",
    text: `Hi ${toName},\n\nYour verification code is: ${otp}\n\nThis code expires in 10 minutes. Do not share it with anyone.\n\n– Team Yuva Western Outfit`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Email Verification</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#e8531a 0%,#f97316 100%);padding:36px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Yuva Western Outfit</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Verify your email address</p>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px;font-size:16px;color:#333;">Hi <strong>${toName}</strong>,</p>
              <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">
                Thanks for creating an account with Yuva Western Outfit! Please use the verification code below to complete your registration.
              </p>
              <!-- OTP Box -->
              <div style="text-align:center;margin:0 0 32px;">
                <div style="display:inline-block;background:#fff7ed;border:2px dashed #f97316;border-radius:12px;padding:20px 40px;">
                  <p style="margin:0 0 6px;font-size:12px;color:#999;text-transform:uppercase;letter-spacing:1px;">Your verification code</p>
                  <p style="margin:0;font-size:42px;font-weight:800;color:#e8531a;letter-spacing:10px;">${otp}</p>
                </div>
              </div>
              <p style="margin:0 0 8px;font-size:14px;color:#777;text-align:center;">
                ⏱ This code expires in <strong>10 minutes</strong>.
              </p>
              <p style="margin:0 0 28px;font-size:13px;color:#aaa;text-align:center;">
                Never share this code with anyone. Yuva Western Outfit staff will never ask for it.
              </p>
              <hr style="border:none;border-top:1px solid #eee;margin:0 0 24px;"/>
              <p style="margin:0;font-size:13px;color:#aaa;text-align:center;">
                If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#fafafa;border-top:1px solid #f0f0f0;padding:20px 40px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#bbb;">© ${new Date().getFullYear()} Yuva Western Outfit. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
  await transporter.sendMail(mailOptions);
};

module.exports = { sendOTPEmail, sendSignupVerificationEmail };
