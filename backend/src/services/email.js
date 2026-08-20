/**
 * Email Service — Nodemailer with Gmail SMTP
 *
 * Uses Gmail App Password authentication (no domain verification needed).
 * Provides email templates for each notification type.
 *
 * Env vars: EMAIL_USER (Gmail address), EMAIL_PASS (Gmail App Password)
 */

const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (!transporter && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Build email content based on notification type and payload.
 */
function buildEmail(type, recipientEmail, recipientName, payload) {
  const base = {
    from: `"HealthConnect" <${process.env.EMAIL_USER}>`,
    to: recipientEmail,
  };

  switch (type) {
    case "EMAIL_BOOKING_CONFIRM":
      return {
        ...base,
        subject: "✅ Appointment Confirmed — HealthConnect",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #3182ce;">Appointment Confirmed!</h2>
            <p>Hi ${recipientName},</p>
            <p>Your appointment has been confirmed:</p>
            <div style="background: #f7fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p><strong>Date & Time:</strong> ${new Date(payload.slotStartTime).toLocaleString()}</p>
              ${payload.doctorName ? `<p><strong>Doctor:</strong> ${payload.doctorName}</p>` : ""}
            </div>
            <p>Please arrive 10 minutes early. You can cancel up to 24 hours before.</p>
            <p style="color: #718096;">— HealthConnect Team</p>
          </div>
        `,
      };

    case "EMAIL_CANCELLATION":
      return {
        ...base,
        subject: "❌ Appointment Cancelled — HealthConnect",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #e53e3e;">Appointment Cancelled</h2>
            <p>Hi ${recipientName},</p>
            <p>Your appointment has been cancelled:</p>
            <div style="background: #fff5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p><strong>Doctor:</strong> ${payload.doctorName || "N/A"}</p>
              <p><strong>Was scheduled for:</strong> ${new Date(payload.slotStartTime).toLocaleString()}</p>
              <p><strong>Cancelled by:</strong> ${payload.cancelledBy || "System"}</p>
            </div>
            <p>You can rebook by visiting our platform.</p>
            <p style="color: #718096;">— HealthConnect Team</p>
          </div>
        `,
      };

    case "LEAVE_CONFLICT":
      return {
        ...base,
        subject: "⚠️ Doctor on Leave — Appointment Cancelled",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #d69e2e;">Doctor on Leave</h2>
            <p>Hi ${recipientName},</p>
            <p>Unfortunately, your appointment has been automatically cancelled because your doctor is on leave:</p>
            <div style="background: #fffff0; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p><strong>Doctor:</strong> ${payload.doctorName || "N/A"}</p>
              <p><strong>Leave date:</strong> ${payload.leaveDate || "N/A"}</p>
              <p><strong>Reason:</strong> ${payload.reason || "Personal leave"}</p>
            </div>
            <p>Please rebook with another available slot or a different doctor.</p>
            <p style="color: #718096;">— HealthConnect Team</p>
          </div>
        `,
      };

    case "EMAIL_REMINDER":
      return {
        ...base,
        subject: "🔔 Appointment Reminder — Tomorrow",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #3182ce;">Appointment Reminder</h2>
            <p>Hi ${recipientName},</p>
            <p>This is a reminder that you have an appointment tomorrow:</p>
            <div style="background: #ebf8ff; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p><strong>Date & Time:</strong> ${new Date(payload.slotStartTime).toLocaleString()}</p>
              ${payload.doctorName ? `<p><strong>Doctor:</strong> ${payload.doctorName}</p>` : ""}
            </div>
            <p>Please arrive 10 minutes early.</p>
            <p style="color: #718096;">— HealthConnect Team</p>
          </div>
        `,
      };

    case "MEDICATION_REMINDER":
      return {
        ...base,
        subject: "💊 Medication Reminder — HealthConnect",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #38a169;">Medication Reminder</h2>
            <p>Hi ${recipientName},</p>
            <p>It's time to take your medication:</p>
            <div style="background: #f0fff4; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p><strong>Drug:</strong> ${payload.drug || "N/A"}</p>
              <p><strong>Dosage:</strong> ${payload.dosage || "N/A"}</p>
              <p><strong>Frequency:</strong> ${payload.frequency || "N/A"}</p>
            </div>
            <p>Stay on track with your medication schedule for the best recovery!</p>
            <p style="color: #718096;">— HealthConnect Team</p>
          </div>
        `,
      };

    default:
      return {
        ...base,
        subject: "HealthConnect Notification",
        html: `<p>Hi ${recipientName}, you have a new notification from HealthConnect.</p>`,
      };
  }
}

/**
 * Send an email. Returns { success, error }.
 */
async function sendEmail(type, recipientEmail, recipientName, payload) {
  const transport = getTransporter();
  if (!transport) {
    return { success: false, error: "Email not configured (missing EMAIL_USER/EMAIL_PASS)" };
  }

  try {
    const mailOptions = buildEmail(type, recipientEmail, recipientName, payload);
    const info = await transport.sendMail(mailOptions);
    console.log(`[Email] Sent ${type} to ${recipientEmail}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[Email] Failed to send ${type} to ${recipientEmail}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendEmail };
