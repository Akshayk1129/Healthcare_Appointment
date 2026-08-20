/**
 * Google Calendar Routes
 *
 * GET  /api/calendar/auth     — initiates OAuth flow
 * GET  /api/calendar/callback — handles OAuth callback
 * GET  /api/calendar/status   — checks if user has connected Calendar
 */

const express = require("express");
const { authenticate } = require("../middleware/auth");
const calendarService = require("../services/calendar");

const router = express.Router();

/**
 * GET /api/calendar/auth
 * Redirect the user to Google OAuth consent screen.
 */
router.get("/auth", authenticate, (req, res) => {
  const authUrl = calendarService.getAuthUrl(req.user.id);

  if (!authUrl) {
    return res.status(503).json({
      error: "Google Calendar integration not configured. Missing GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI.",
    });
  }

  return res.json({ authUrl });
});

/**
 * GET /api/calendar/callback
 * Handle the OAuth callback from Google.
 * Exchanges the authorization code for tokens and stores them.
 */
router.get("/callback", async (req, res) => {
  try {
    const { code, state: userId } = req.query;

    if (!code || !userId) {
      return res.status(400).send(`
        <html><body style="font-family: Arial; text-align: center; padding: 50px;">
          <h2 style="color: #e53e3e;">❌ Authorization Failed</h2>
          <p>Missing authorization code or user ID.</p>
        </body></html>
      `);
    }

    await calendarService.handleCallback(code, userId);

    // Get the frontend URL for redirect
    const frontendUrl = process.env.FRONTEND_URL || "https://healthcare-frontend-4l6i.onrender.com";

    return res.send(`
      <html><body style="font-family: Arial; text-align: center; padding: 50px; background: #0a0e1a; color: #f1f5f9;">
        <h2 style="color: #34d399;">✅ Google Calendar Connected!</h2>
        <p>Your Google Calendar has been linked to HealthConnect.</p>
        <p>Calendar events will be automatically created when you book appointments.</p>
        <p><a href="${frontendUrl}/#/my-appointments" style="color: #63b3ed;">Return to HealthConnect →</a></p>
        <script>setTimeout(() => window.location.href = "${frontendUrl}/#/my-appointments", 3000);</script>
      </body></html>
    `);
  } catch (err) {
    console.error("[Calendar] OAuth callback error:", err.message);
    return res.status(500).send(`
      <html><body style="font-family: Arial; text-align: center; padding: 50px;">
        <h2 style="color: #e53e3e;">❌ Connection Failed</h2>
        <p>${err.message}</p>
        <p>Please try again.</p>
      </body></html>
    `);
  }
});

/**
 * GET /api/calendar/status
 * Check if the current user has connected their Google Calendar.
 */
router.get("/status", authenticate, async (req, res) => {
  try {
    const connected = await calendarService.isConnected(req.user.id);
    return res.json({ connected });
  } catch (err) {
    return res.json({ connected: false });
  }
});

module.exports = router;
