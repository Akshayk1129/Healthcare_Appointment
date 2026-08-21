# Healthcare Appointment & Follow-up Manager

A comprehensive, concurrency-safe healthcare booking system built with React, Node.js, Express, and PostgreSQL (Prisma). It features atomic slot holds to prevent double-booking, robust background jobs for email notifications, AI-powered symptom analysis, and seamless Google Calendar synchronization.

## Deployed URLs
- **Frontend:** https://healthcare-frontend-4l6i.onrender.com
- **Backend API:** https://healthcare-api-4y2l.onrender.com

## Default Admin Credentials
- **Email:** `admin@healthcare.com`
- **Password:** `admin123`

---

## 1. Local Setup Guide

### Prerequisites
- Node.js (v18+)
- PostgreSQL (v14+)
- Google Cloud Console Account (for OAuth)
- Gemini API Key

### Backend Setup
1. `cd backend`
2. `npm install`
3. Copy `.env.example` to `.env` and fill in the values:
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/healthcare_db"
   JWT_SECRET="your-secret"
   EMAIL_USER="your-email@gmail.com"
   EMAIL_PASS="your-app-password"
   GEMINI_API_KEY="your-gemini-key"
   GOOGLE_CLIENT_ID="your-client-id"
   GOOGLE_CLIENT_SECRET="your-client-secret"
   GOOGLE_REDIRECT_URI="http://localhost:5000/api/calendar/callback"
   FRONTEND_URL="http://localhost:5173"
   ```
4. Initialize the database: `npx prisma migrate dev`
5. Seed the default admin user: `npm run db:seed`
6. Start the development server: `npm run dev` (runs on port 5000)

### Frontend Setup
1. `cd frontend`
2. `npm install`
3. Copy `.env.example` to `.env`:
   ```env
   VITE_API_URL="http://localhost:5000"
   ```
4. Start the Vite development server: `npm run dev`

---

## 2. API Documentation

All protected endpoints require a `Bearer <token>` in the `Authorization` header.

### Authentication
- `POST /api/auth/register` (Public) - Create a patient account.
- `POST /api/auth/login` (Public) - Login and receive a JWT.

### Admin
- `POST /api/admin/doctors` (Admin) - Create a new doctor profile.
- `PUT /api/admin/doctors/:id` (Admin) - Edit a doctor profile.
- `POST /api/admin/doctors/:id/generate-slots` (Admin) - Generate 7 days of available slots.
- `POST /api/admin/doctors/:id/leave` (Admin) - Mark a doctor on leave, triggering cascading cancellations.

### Appointments & Slots
- `GET /api/doctors` (Public) - List all doctors.
- `GET /api/doctors/:id/slots` (Public) - List available slots for a doctor.
- `POST /api/appointments/:slotId/hold` (Patient) - Atomically reserve a slot for 5 minutes.
- `POST /api/appointments/:id/symptoms` (Patient) - Submit symptoms for AI analysis.
- `POST /api/appointments/:id/confirm` (Patient) - Confirm a held slot and trigger email.
- `POST /api/appointments/:id/cancel` (Patient) - Cancel an appointment.
- `POST /api/appointments/:id/post-visit` (Doctor) - Generate a post-visit AI summary and medication schedule.

### Calendar
- `GET /api/calendar/auth` - Get the Google OAuth consent URL.
- `GET /api/calendar/status` - Check if the user's calendar is linked.

---

## 3. Database Schema Overview

The database is built on PostgreSQL using Prisma. Key entities include:

- **User:** Stores authentication details and role (`PATIENT`, `DOCTOR`, `ADMIN`).
- **DoctorProfile:** Extends the User model for doctors with specialisation and working hours.
- **Slot:** Represents a bookable time window. Tracks `status` (`AVAILABLE`, `PENDING_HOLD`, `BOOKED`) and incorporates an optimistic locking `version` column. Contains a compound unique constraint on `[doctorId, slotStartTime]` to prevent overlapping slots.
- **Appointment:** Represents a confirmed booking, linking a Patient to a Slot. Stores AI symptom analysis, clinical notes, and AI post-visit summaries.
- **NotificationJob:** A queue table for background email processing. Tracks `status` (`PENDING`, `PROCESSING`, `RETRYING`, `SENT`, `FAILED`), retry attempts, and exponential backoff metadata.
- **GoogleCalendarToken:** Securely stores encrypted OAuth access and refresh tokens per user.

---

## 4. LLM Prompts Used

We use Google's Gemini API for two primary intelligence tasks.

### 1. Pre-Visit Symptom Analysis
```text
You are a medical triage assistant. Analyze the following symptoms and provide a JSON response.
Do NOT include markdown formatting or backticks, just the raw JSON object.
Symptoms: "${symptoms}"
Output strictly in this format:
{
  "urgency": "High" | "Medium" | "Low",
  "possibleConditions": ["Condition 1", "Condition 2"],
  "recommendedQuestions": ["Question to ask doctor 1", "Question 2"]
}
```

### 2. Post-Visit Summary & Medication Extraction
```text
You are a medical assistant. Based on the doctor's clinical notes below, provide a JSON response containing a patient-friendly summary and a structured medication schedule.
Do NOT include markdown formatting or backticks, just the raw JSON object.
Clinical Notes: "${clinicalNotes}"
Output strictly in this format:
{
  "summaryForPatient": "Clear, jargon-free explanation of the visit.",
  "medications": [
    {
      "name": "Medication Name",
      "dosage": "e.g., 500mg",
      "frequency": "e.g., twice a day",
      "duration": "e.g., 5 days"
    }
  ]
}
```

---

## 5. Google Calendar Setup Steps

To replicate the Calendar integration on a fresh deployment:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new Project.
3. Navigate to **APIs & Services > Library** and enable the **Google Calendar API**.
4. Navigate to **OAuth consent screen**:
   - Choose **External** user type.
   - Fill in the App name, Support email, and Developer contact info.
   - Add the scope: `https://www.googleapis.com/auth/calendar.events`
   - Add test users (required while the app is in "Testing" mode).
5. Navigate to **Credentials > Create Credentials > OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs: 
     - Local: `http://localhost:5000/api/calendar/callback`
     - Production: `https://healthcare-api-4y2l.onrender.com/api/calendar/callback`
6. Copy the resulting **Client ID** and **Client Secret** into your `.env` (and Render Dashboard).

---

## 6. Known Limitations

During the 5-day build, we identified the following limitations that should be addressed in a full production system:

1. **Doctor Deletion Cascades Unnotified:** Deleting a Doctor profile utilizes Prisma's `onDelete: Cascade` to preserve data integrity. However, it does not currently generate notification jobs to warn patients that their associated appointments have been cancelled. A soft-delete mechanism is recommended for V2.
2. **Google OAuth Expiry:** Because the Google Cloud OAuth app is currently in "Testing" status (unverified by Google), Google automatically expires Refresh Tokens after 7 days. Users must re-authenticate weekly until the app is published.
3. **Render Free-Tier Cold Starts:** The backend API is hosted on Render's free tier. If inactive for 15 minutes, the server spins down. The next request may take 30-50 seconds to respond. This can momentarily delay background jobs (like the hold-expiry sweep).
4. **Rate Limiting Scope:** The current implementation of `express-rate-limit` tracks by IP address. In environments where multiple users share a NAT or VPN IP, they share the same rate-limit quota for the LLM endpoints.
