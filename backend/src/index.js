require("dotenv").config();

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const doctorRoutes = require("./routes/doctors");
const appointmentRoutes = require("./routes/appointments");
const calendarRoutes = require("./routes/calendar");
const { startHoldExpirySweep } = require("./jobs/holdExpiry");
const { startNotificationWorker } = require("./jobs/notificationWorker");
const { startReminderScheduler } = require("./jobs/reminderScheduler");

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// ─── Health Check ───────────────────────────────────────────────────────────

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "Healthcare Appointment API",
  });
});

// ─── Routes ─────────────────────────────────────────────────────────────────

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/doctors", doctorRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/calendar", calendarRoutes);

// ─── 404 Handler ────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ─── Global Error Handler ───────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start Server ───────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);

  // Start background jobs
  startHoldExpirySweep();
  startNotificationWorker();
  startReminderScheduler();
});
