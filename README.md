# HealthConnect — Healthcare Appointment & Follow-up Manager

A full-stack platform with three portals (Patient, Doctor, Admin) for managing healthcare appointments with AI-powered visit summaries, real-time scheduling, and automated notifications.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express, PostgreSQL |
| ORM | Prisma |
| Frontend | React (Vite) |
| Auth | JWT (role-based) |

## Quick Start

### Prerequisites

- Node.js ≥ 18
- PostgreSQL ≥ 14
- npm or yarn

### 1. Clone & Install

```bash
git clone <repo-url>
cd Healthcare_Appointment

# Backend
cd backend
cp .env.example .env   # Edit with your DB credentials
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Database Setup

```bash
cd backend

# Run migrations
npx prisma migrate dev

# Seed the admin user
npm run db:seed
```

Default admin credentials: `admin@healthcare.com` / `admin123`

### 3. Run Development Servers

```bash
# Terminal 1 — Backend (port 5000)
cd backend
npm run dev

# Terminal 2 — Frontend (port 3000)
cd frontend
npm run dev
```

### 4. Verify

- **Frontend**: http://localhost:3000
- **API Health Check**: http://localhost:5000/api/health
- **Register a patient**: `POST http://localhost:5000/api/auth/register`
- **Login**: `POST http://localhost:5000/api/auth/login`

## Environment Variables

See [`backend/.env.example`](backend/.env.example) for the full list:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/healthcare_db` |
| `JWT_SECRET` | Secret key for signing JWTs | Any strong random string |
| `PORT` | Backend server port | `5000` |

## API Endpoints

### Auth

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | No | Register a new patient |
| POST | `/api/auth/login` | No | Login (all roles) |
| GET | `/api/auth/me` | Yes | Get current user profile |
| GET | `/api/health` | No | Health check |

## Database Schema

The database uses PostgreSQL with Prisma ORM. Key tables:

- **users** — All users with role-based access (PATIENT, DOCTOR, ADMIN)
- **doctor_profiles** — Specialisation, working hours (JSON), slot duration
- **doctor_leave_days** — Leave calendar per doctor
- **appointments** — Core booking table with double-booking prevention
- **symptom_summaries** — Pre-visit AI summaries (Day 3)
- **post_visit_summaries** — Post-visit AI summaries (Day 3)
- **notification_jobs** — Email/reminder queue with retry support

## Concurrency & Locking Strategy

Double-booking is prevented at the **database level** using a `UNIQUE` constraint on `(doctor_id, slot_start_time)` in the appointments table. This means even if two booking requests arrive simultaneously, only one INSERT can succeed — the other receives a unique constraint violation and is rejected gracefully. This is stronger than application-level checks, which are vulnerable to race conditions between the "check" and the "insert."

For updates (reschedule, cancel), the schema uses **optimistic locking** via a `version` integer column. Any UPDATE must include `WHERE version = <current_version>` — if another transaction modified the row first, the version won't match and the update returns zero rows, signalling a conflict.

The **slot-hold mechanism** uses a `PENDING_HOLD` status with `hold_expires_at` and `hold_owner_token` columns. When a patient begins booking, the slot is held for a short window (e.g. 5 minutes). A background job periodically cleans up expired holds by resetting them to `AVAILABLE`. This is entirely DB-based — no Redis or external cache required.

## Project Structure

```
Healthcare_Appointment/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma    # Database schema
│   │   └── seed.js          # Admin seeding
│   ├── src/
│   │   ├── index.js         # Express server entry
│   │   ├── middleware/
│   │   │   ├── auth.js      # JWT authentication
│   │   │   └── roleGuard.js # Role-based authorization
│   │   ├── routes/
│   │   │   └── auth.js      # Auth endpoints
│   │   └── utils/
│   │       ├── jwt.js       # Token helpers
│   │       └── prisma.js    # Prisma client singleton
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Landing page
│   │   ├── main.jsx         # React entry
│   │   └── index.css        # Design system
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── docs/                    # Documentation (Day 5)
├── .gitignore
└── README.md
```

## Deployment

- **Backend**: Render Web Service (free tier)
- **Frontend**: Render Static Site or Vercel
- **Database**: Render PostgreSQL (free tier)

## License

This project is a graded assignment submission.
