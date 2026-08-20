const express = require("express");
const crypto = require("crypto");
const prisma = require("../utils/prisma");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/roleGuard");

const router = express.Router();

/**
 * POST /api/appointments/:id/hold
 *
 * Atomically claim a slot using a compare-and-swap UPDATE.
 * Only succeeds if the slot's current status is AVAILABLE.
 * Two simultaneous requests for the same slot: exactly one wins.
 *
 * This is the core concurrency-safety mechanism. The single UPDATE
 * statement with WHERE status = 'AVAILABLE' is atomic at the PostgreSQL
 * row level — no explicit SELECT FOR UPDATE needed.
 */
router.post("/:id/hold", authenticate, authorize("PATIENT"), async (req, res) => {
  try {
    const { id } = req.params;
    const patientId = req.user.id;
    const holdOwnerToken = crypto.randomUUID();

    // Atomic compare-and-swap: only updates if status is AVAILABLE
    const result = await prisma.$queryRawUnsafe(
      `UPDATE appointments
       SET status = 'PENDING_HOLD',
           patient_id = $1,
           hold_expires_at = NOW() + INTERVAL '5 minutes',
           hold_owner_token = $2,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $3
         AND status = 'AVAILABLE'
       RETURNING id, status, slot_start_time, slot_end_time, hold_expires_at, hold_owner_token`,
      patientId,
      holdOwnerToken,
      id
    );

    if (!result || result.length === 0) {
      // Either the slot doesn't exist or it's no longer AVAILABLE
      const slot = await prisma.appointment.findUnique({ where: { id } });
      if (!slot) {
        return res.status(404).json({ error: "Slot not found" });
      }
      return res.status(409).json({
        error: "Slot is no longer available",
        currentStatus: slot.status,
      });
    }

    const held = result[0];
    return res.json({
      message: "Slot held successfully. Confirm within 5 minutes.",
      appointment: {
        id: held.id,
        status: held.status,
        slotStartTime: held.slot_start_time,
        slotEndTime: held.slot_end_time,
        holdExpiresAt: held.hold_expires_at,
        holdOwnerToken: held.hold_owner_token,
      },
    });
  } catch (err) {
    console.error("Hold slot error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/appointments/:id/confirm
 *
 * Confirm a held slot. Requires the holdOwnerToken from the hold step.
 * Fails if:
 *  - Slot is not in PENDING_HOLD status
 *  - holdOwnerToken doesn't match
 *  - Hold has expired (holdExpiresAt < now)
 *
 * Uses optimistic locking via the version column.
 */
router.post("/:id/confirm", authenticate, authorize("PATIENT"), async (req, res) => {
  try {
    const { id } = req.params;
    const { holdOwnerToken } = req.body;

    if (!holdOwnerToken) {
      return res.status(400).json({ error: "holdOwnerToken is required" });
    }

    // Atomic confirm: only updates if status is PENDING_HOLD, token matches,
    // and hold hasn't expired
    const result = await prisma.$queryRawUnsafe(
      `UPDATE appointments
       SET status = 'BOOKED',
           hold_expires_at = NULL,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1
         AND status = 'PENDING_HOLD'
         AND hold_owner_token = $2
         AND hold_expires_at > NOW()
       RETURNING id, status, slot_start_time, slot_end_time, patient_id`,
      id,
      holdOwnerToken
    );

    if (!result || result.length === 0) {
      const slot = await prisma.appointment.findUnique({ where: { id } });
      if (!slot) {
        return res.status(404).json({ error: "Slot not found" });
      }
      if (slot.status !== "PENDING_HOLD") {
        return res.status(409).json({
          error: "Slot is not in a held state",
          currentStatus: slot.status,
        });
      }
      if (slot.holdOwnerToken !== holdOwnerToken) {
        return res.status(403).json({ error: "Invalid hold token" });
      }
      if (slot.holdExpiresAt && slot.holdExpiresAt < new Date()) {
        return res.status(410).json({ error: "Hold has expired. Please try booking again." });
      }
      return res.status(409).json({ error: "Could not confirm slot" });
    }

    const confirmed = result[0];

    // Create a booking confirmation notification job
    await prisma.notificationJob.create({
      data: {
        type: "EMAIL_BOOKING_CONFIRM",
        recipientId: confirmed.patient_id,
        payload: {
          appointmentId: confirmed.id,
          slotStartTime: confirmed.slot_start_time,
          slotEndTime: confirmed.slot_end_time,
        },
      },
    });

    return res.json({
      message: "Appointment confirmed!",
      appointment: {
        id: confirmed.id,
        status: confirmed.status,
        slotStartTime: confirmed.slot_start_time,
        slotEndTime: confirmed.slot_end_time,
      },
    });
  } catch (err) {
    console.error("Confirm slot error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/appointments/:id/cancel
 *
 * Cancel a BOOKED appointment. Resets the slot back to AVAILABLE.
 * Creates a NotificationJob for the cancellation.
 * Accessible by the patient who booked it or any doctor/admin.
 */
router.post("/:id/cancel", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        doctor: { include: { user: { select: { name: true } } } },
      },
    });

    if (!appointment) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    if (appointment.status !== "BOOKED") {
      return res.status(409).json({
        error: "Only BOOKED appointments can be cancelled",
        currentStatus: appointment.status,
      });
    }

    // Authorization: patient who booked, or doctor, or admin
    const isOwner = appointment.patientId === req.user.id;
    const isPrivileged = ["DOCTOR", "ADMIN"].includes(req.user.role);
    if (!isOwner && !isPrivileged) {
      return res.status(403).json({ error: "Not authorized to cancel this appointment" });
    }

    // Optimistic locking: include version in WHERE
    const result = await prisma.$queryRawUnsafe(
      `UPDATE appointments
       SET status = 'AVAILABLE',
           patient_id = NULL,
           hold_expires_at = NULL,
           hold_owner_token = NULL,
           notes = NULL,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1
         AND version = $2
       RETURNING id, status`,
      id,
      appointment.version
    );

    if (!result || result.length === 0) {
      return res.status(409).json({
        error: "Conflict: appointment was modified by another request. Please retry.",
      });
    }

    // Create cancellation notification if there was a patient
    if (appointment.patientId) {
      await prisma.notificationJob.create({
        data: {
          type: "EMAIL_CANCELLATION",
          recipientId: appointment.patientId,
          payload: {
            appointmentId: id,
            doctorName: appointment.doctor.user.name,
            slotStartTime: appointment.slotStartTime.toISOString(),
            cancelledBy: req.user.role,
          },
        },
      });
    }

    return res.json({
      message: "Appointment cancelled and slot freed",
      appointment: { id, status: "AVAILABLE" },
    });
  } catch (err) {
    console.error("Cancel appointment error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/appointments/my
 * List the current patient's appointments (BOOKED, PENDING_HOLD, COMPLETED).
 */
router.get("/my", authenticate, authorize("PATIENT"), async (req, res) => {
  try {
    const appointments = await prisma.appointment.findMany({
      where: {
        patientId: req.user.id,
        status: { in: ["BOOKED", "PENDING_HOLD", "COMPLETED"] },
      },
      include: {
        doctor: {
          include: { user: { select: { name: true, email: true } } },
        },
      },
      orderBy: { slotStartTime: "asc" },
    });

    return res.json({
      appointments: appointments.map((a) => ({
        id: a.id,
        doctorName: a.doctor.user.name,
        specialisation: a.doctor.specialisation,
        slotStartTime: a.slotStartTime,
        slotEndTime: a.slotEndTime,
        status: a.status,
        holdExpiresAt: a.holdExpiresAt,
      })),
    });
  } catch (err) {
    console.error("My appointments error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
