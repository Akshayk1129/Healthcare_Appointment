/**
 * Google Calendar Service — OAuth 2.0 + Calendar Events
 *
 * Handles OAuth token storage/refresh and calendar event CRUD.
 * All operations are wrapped in try/catch — failures are logged but never
 * break the booking flow.
 *
 * Env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
 */

const { google } = require("googleapis");
const prisma = require("../utils/prisma");

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

/**
 * Create an OAuth2 client instance.
 */
function createOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Generate the Google OAuth consent URL.
 */
function getAuthUrl(userId) {
  const oauth2Client = createOAuth2Client();
  if (!oauth2Client) return null;

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state: userId, // pass userId through OAuth state param
  });
}

/**
 * Exchange authorization code for tokens and store them.
 */
async function handleCallback(code, userId) {
  const oauth2Client = createOAuth2Client();
  if (!oauth2Client) throw new Error("OAuth not configured");

  const { tokens } = await oauth2Client.getToken(code);

  // Upsert the token record
  await prisma.googleCalendarToken.upsert({
    where: { userId },
    update: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || "",
      expiresAt: new Date(tokens.expiry_date),
    },
    create: {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || "",
      expiresAt: new Date(tokens.expiry_date),
    },
  });

  return tokens;
}

/**
 * Get an authenticated OAuth2 client for a user.
 * Refreshes the token if expired.
 */
async function getAuthenticatedClient(userId) {
  const tokenRecord = await prisma.googleCalendarToken.findUnique({
    where: { userId },
  });

  if (!tokenRecord) return null;

  const oauth2Client = createOAuth2Client();
  if (!oauth2Client) return null;

  oauth2Client.setCredentials({
    access_token: tokenRecord.accessToken,
    refresh_token: tokenRecord.refreshToken,
    expiry_date: tokenRecord.expiresAt.getTime(),
  });

  // Check if token is expired and refresh
  if (tokenRecord.expiresAt < new Date()) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      await prisma.googleCalendarToken.update({
        where: { userId },
        data: {
          accessToken: credentials.access_token,
          expiresAt: new Date(credentials.expiry_date),
        },
      });
      oauth2Client.setCredentials(credentials);
    } catch (err) {
      console.error("[Calendar] Token refresh failed:", err.message);
      return null;
    }
  }

  return oauth2Client;
}

/**
 * Create a Google Calendar event. Returns the event ID or null.
 */
async function createEvent(userId, appointmentData) {
  try {
    const auth = await getAuthenticatedClient(userId);
    if (!auth) {
      console.log(`[Calendar] User ${userId} not connected — skipping event creation`);
      return null;
    }

    const calendar = google.calendar({ version: "v3", auth });

    const event = {
      summary: `HealthConnect: ${appointmentData.doctorName || "Appointment"}`,
      description: `Healthcare appointment via HealthConnect.\nDoctor: ${appointmentData.doctorName || "N/A"}\nSpecialisation: ${appointmentData.specialisation || "N/A"}`,
      start: {
        dateTime: new Date(appointmentData.slotStartTime).toISOString(),
        timeZone: "Asia/Kolkata",
      },
      end: {
        dateTime: new Date(appointmentData.slotEndTime).toISOString(),
        timeZone: "Asia/Kolkata",
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 60 },
          { method: "popup", minutes: 15 },
        ],
      },
    };

    const response = await calendar.events.insert({
      calendarId: "primary",
      resource: event,
    });

    console.log(`[Calendar] Event created for user ${userId}: ${response.data.id}`);
    return response.data.id;
  } catch (err) {
    console.error(`[Calendar] Failed to create event for user ${userId}:`, err.message);
    return null;
  }
}

/**
 * Delete a Google Calendar event. Returns true on success.
 */
async function deleteEvent(userId, eventId) {
  try {
    if (!eventId) return false;

    const auth = await getAuthenticatedClient(userId);
    if (!auth) return false;

    const calendar = google.calendar({ version: "v3", auth });

    await calendar.events.delete({
      calendarId: "primary",
      eventId,
    });

    console.log(`[Calendar] Event ${eventId} deleted for user ${userId}`);
    return true;
  } catch (err) {
    console.error(`[Calendar] Failed to delete event ${eventId}:`, err.message);
    return false;
  }
}

/**
 * Update a Google Calendar event time. Returns true on success.
 */
async function updateEvent(userId, eventId, appointmentData) {
  try {
    if (!eventId) return false;
    const auth = await getAuthenticatedClient(userId);
    if (!auth) return false;

    const calendar = google.calendar({ version: "v3", auth });
    
    // Fetch the existing event to keep other properties intact
    const existingEvent = await calendar.events.get({
      calendarId: "primary",
      eventId,
    });

    const event = {
      ...existingEvent.data,
      start: {
        dateTime: new Date(appointmentData.slotStartTime).toISOString(),
        timeZone: "Asia/Kolkata",
      },
      end: {
        dateTime: new Date(appointmentData.slotEndTime).toISOString(),
        timeZone: "Asia/Kolkata",
      },
    };

    await calendar.events.update({
      calendarId: "primary",
      eventId,
      resource: event,
    });

    console.log(`[Calendar] Event ${eventId} updated for user ${userId}`);
    return true;
  } catch (err) {
    console.error(`[Calendar] Failed to update event ${eventId} for user ${userId}:`, err.message);
    return false;
  }
}

/**
 * Check if a user has connected their Google Calendar.
 */
async function isConnected(userId) {
  const token = await prisma.googleCalendarToken.findUnique({
    where: { userId },
  });
  return !!token;
}

module.exports = {
  createOAuth2Client,
  getAuthUrl,
  handleCallback,
  createEvent,
  deleteEvent,
  updateEvent,
  isConnected,
};
