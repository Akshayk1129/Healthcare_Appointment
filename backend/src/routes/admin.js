const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../utils/prisma");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/roleGuard");

const router = express.Router();

// All admin routes require ADMIN role
router.use(authenticate, authorize("ADMIN"));

/**
 * POST /api/admin/doctors
 * Create a new doctor user + doctor profile in a single transaction.
 */
router.post("/doctors", async (req, res) => {
  try {
    const { email, password, name, phone, specialisation, workingHours, slotDurationMinutes } = req.body;

    if (!email || !password || !name || !specialisation || !workingHours) {
      return res.status(400).json({
        error: "email, password, name, specialisation, and workingHours are required",
      });
    }

    // Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Transaction: create User + DoctorProfile atomically
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
          phone: phone || null,
          role: "DOCTOR",
        },
      });

      const profile = await tx.doctorProfile.create({
        data: {
          userId: user.id,
          specialisation,
          workingHours,
          slotDurationMinutes: slotDurationMinutes || 30,
        },
      });

      return { user, profile };
    });

    return res.status(201).json({
      doctor: {
        id: result.profile.id,
        userId: result.user.id,
        email: result.user.email,
        name: result.user.name,
        specialisation: result.profile.specialisation,
        workingHours: result.profile.workingHours,
        slotDurationMinutes: result.profile.slotDurationMinutes,
      },
    });
  } catch (err) {
    console.error("Create doctor error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /api/admin/doctors/:id
 * Update a doctor profile (specialisation, workingHours, slotDurationMinutes).
 */
router.put("/doctors/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { specialisation, workingHours, slotDurationMinutes } = req.body;

    const profile = await prisma.doctorProfile.findUnique({ where: { id } });
    if (!profile) {
      return res.status(404).json({ error: "Doctor profile not found" });
    }

    const updated = await prisma.doctorProfile.update({
      where: { id },
      data: {
        ...(specialisation !== undefined && { specialisation }),
        ...(workingHours !== undefined && { workingHours }),
        ...(slotDurationMinutes !== undefined && { slotDurationMinutes }),
      },
      include: { user: { select: { email: true, name: true } } },
    });

    return res.json({ doctor: updated });
  } catch (err) {
    console.error("Update doctor error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/admin/doctors/:id/generate-slots
 * Generate AVAILABLE appointment rows for the next N days.
 * Skips days the doctor is on leave and days outside working_hours.
 * Uses createMany with skipDuplicates to allow safe re-runs.
 */
router.post("/doctors/:id/generate-slots", async (req, res) => {
  try {
    const { id } = req.params;
    const days = parseInt(req.body.days) || 14;

    const profile = await prisma.doctorProfile.findUnique({
      where: { id },
      include: { leaveDays: true },
    });

    if (!profile) {
      return res.status(404).json({ error: "Doctor profile not found" });
    }

    const workingHours = profile.workingHours;
    const slotDuration = profile.slotDurationMinutes;

    // Build a set of leave dates for fast lookup (YYYY-MM-DD strings)
    const leaveDateSet = new Set(
      profile.leaveDays.map((ld) => ld.leaveDate.toISOString().split("T")[0])
    );

    const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const slots = [];
    const now = new Date();

    for (let d = 0; d < days; d++) {
      const date = new Date(now);
      date.setDate(date.getDate() + d);
      const dateStr = date.toISOString().split("T")[0];

      // Skip leave days
      if (leaveDateSet.has(dateStr)) continue;

      const dayName = dayNames[date.getDay()];
      const hours = workingHours[dayName];

      // Skip if doctor doesn't work this day
      if (!hours || !hours.start || !hours.end) continue;

      // Parse start/end times
      const [startH, startM] = hours.start.split(":").map(Number);
      const [endH, endM] = hours.end.split(":").map(Number);

      const slotStart = new Date(date);
      slotStart.setHours(startH, startM, 0, 0);

      const dayEnd = new Date(date);
      dayEnd.setHours(endH, endM, 0, 0);

      // Generate slots at slotDuration intervals
      while (slotStart < dayEnd) {
        const slotEnd = new Date(slotStart.getTime() + slotDuration * 60000);
        if (slotEnd > dayEnd) break;

        slots.push({
          doctorId: id,
          slotStartTime: new Date(slotStart),
          slotEndTime: new Date(slotEnd),
          status: "AVAILABLE",
        });

        slotStart.setTime(slotStart.getTime() + slotDuration * 60000);
      }
    }

    // Bulk insert, skip duplicates (safe for re-runs)
    const created = await prisma.appointment.createMany({
      data: slots,
      skipDuplicates: true,
    });

    return res.status(201).json({
      message: `Generated ${created.count} new slots (${slots.length} total attempted, duplicates skipped)`,
      slotsGenerated: created.count,
      daysScanned: days,
    });
  } catch (err) {
    console.error("Generate slots error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/admin/doctors/:id/leave
 * Mark a doctor on leave for a specific date.
 * Cancels all BOOKED appointments on that date and creates
 * NotificationJob rows for affected patients.
 */
router.post("/doctors/:id/leave", async (req, res) => {
  try {
    const { id } = req.params;
    const { date, reason } = req.body;

    if (!date) {
      return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
    }

    const profile = await prisma.doctorProfile.findUnique({
      where: { id },
      include: { user: { select: { name: true } } },
    });

    if (!profile) {
      return res.status(404).json({ error: "Doctor profile not found" });
    }

    const leaveDate = new Date(date + "T00:00:00.000Z");

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create leave day record
      const leave = await tx.doctorLeaveDay.create({
        data: {
          doctorId: id,
          leaveDate,
          reason: reason || null,
        },
      });

      // 2. Find all BOOKED appointments on this date for this doctor
      const startOfDay = new Date(leaveDate);
      const endOfDay = new Date(leaveDate);
      endOfDay.setDate(endOfDay.getDate() + 1);

      const bookedAppointments = await tx.appointment.findMany({
        where: {
          doctorId: id,
          status: "BOOKED",
          slotStartTime: { gte: startOfDay, lt: endOfDay },
        },
        include: { patient: { select: { id: true, name: true, email: true } } },
      });

      // 3. Cancel those appointments
      if (bookedAppointments.length > 0) {
        await tx.appointment.updateMany({
          where: {
            id: { in: bookedAppointments.map((a) => a.id) },
          },
          data: {
            status: "CANCELLED",
            version: { increment: 1 },
          },
        });

        // 4. Create notification jobs for affected patients
        const notificationJobs = bookedAppointments
          .filter((a) => a.patientId)
          .map((a) => ({
            type: "LEAVE_CONFLICT",
            recipientId: a.patientId,
            payload: {
              appointmentId: a.id,
              doctorName: profile.user.name,
              slotStartTime: a.slotStartTime.toISOString(),
              leaveDate: date,
              reason: reason || "Doctor on leave",
            },
          }));

        if (notificationJobs.length > 0) {
          await tx.notificationJob.createMany({ data: notificationJobs });
        }
      }

      // 5. Also cancel any PENDING_HOLD appointments on that date
      await tx.appointment.updateMany({
        where: {
          doctorId: id,
          status: "PENDING_HOLD",
          slotStartTime: { gte: startOfDay, lt: endOfDay },
        },
        data: {
          status: "AVAILABLE",
          patientId: null,
          holdExpiresAt: null,
          holdOwnerToken: null,
          version: { increment: 1 },
        },
      });

      return { leave, cancelledCount: bookedAppointments.length };
    });

    return res.status(201).json({
      message: `Leave marked for ${date}. ${result.cancelledCount} appointment(s) cancelled.`,
      leave: result.leave,
      cancelledAppointments: result.cancelledCount,
    });
  } catch (err) {
    // Handle duplicate leave day
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Leave already marked for this date" });
    }
    console.error("Mark leave error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
