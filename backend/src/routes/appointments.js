const express = require("express");
const crypto = require("crypto");
const prisma = require("../utils/prisma");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/roleGuard");
const { analyzeSymptoms, generatePostVisitSummary } = require("../services/llm");
const calendarService = require("../services/calendar");

const router = express.Router();

/**
 * POST /api/appointments/:id/hold
 *
 * Atomically claim a slot using a compare-and-swap UPDATE.
 * Only succeeds if the slot's current status is AVAILABLE.
 * Two simultaneous requests for the same slot: exactly one wins.
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
 * POST /api/appointments/:id/symptoms
 *
 * Patient submits symptoms before confirming. Calls Gemini for AI analysis.
 * On LLM failure: stores raw symptoms as fallback, never breaks the flow.
 */
router.post("/:id/symptoms", authenticate, authorize("PATIENT"), async (req, res) => {
  try {
    const { id } = req.params;
    const { symptoms } = req.body;

    if (!symptoms || symptoms.trim().length === 0) {
      return res.status(400).json({ error: "symptoms text is required" });
    }

    // Verify the appointment exists and belongs to this patient
    const appointment = await prisma.appointment.findUnique({ where: { id } });
    if (!appointment) {
      return res.status(404).json({ error: "Appointment not found" });
    }
    if (appointment.patientId !== req.user.id) {
      return res.status(403).json({ error: "Not your appointment" });
    }

    // Call LLM (with graceful fallback)
    const analysis = await analyzeSymptoms(symptoms, req);

    // Store in SymptomSummary
    const summary = await prisma.symptomSummary.upsert({
      where: { appointmentId: id },
      update: {
        summary: JSON.stringify(analysis),
        rawInput: symptoms,
        llmFailed: analysis.llmFailed,
      },
      create: {
        appointmentId: id,
        summary: JSON.stringify(analysis),
        rawInput: symptoms,
        llmFailed: analysis.llmFailed,
      },
    });

    return res.json({
      message: analysis.llmFailed
        ? "Symptoms saved (AI analysis unavailable, using fallback)"
        : "Symptoms analysed successfully",
      analysis,
      llmFailed: analysis.llmFailed,
    });
  } catch (err) {
    console.error("Symptoms error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/appointments/:id/confirm
 *
 * Confirm a held slot. Requires the holdOwnerToken from the hold step.
 * After confirming, creates Calendar events for patient and doctor
 * (if they've connected Google Calendar — silently skips otherwise).
 */
router.post("/:id/confirm", authenticate, authorize("PATIENT"), async (req, res) => {
  try {
    const { id } = req.params;
    const { holdOwnerToken } = req.body;

    if (!holdOwnerToken) {
      return res.status(400).json({ error: "holdOwnerToken is required" });
    }

    // Atomic confirm
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
       RETURNING id, status, slot_start_time, slot_end_time, patient_id, doctor_id`,
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

    // Create booking confirmation notification job
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

    // ─── Google Calendar sync (fire-and-forget) ──────────────────────
    // Get doctor info for event title
    const doctorProfile = await prisma.doctorProfile.findUnique({
      where: { id: confirmed.doctor_id },
      include: { user: { select: { id: true, name: true } } },
    });

    const eventData = {
      doctorName: doctorProfile?.user?.name || "Doctor",
      specialisation: doctorProfile?.specialisation || "",
      slotStartTime: confirmed.slot_start_time,
      slotEndTime: confirmed.slot_end_time,
    };

    // Create calendar event for patient
    const patientEventId = await calendarService.createEvent(confirmed.patient_id, eventData);

    // Create calendar event for doctor
    let doctorEventId = null;
    if (doctorProfile?.user?.id) {
      doctorEventId = await calendarService.createEvent(doctorProfile.user.id, {
        ...eventData,
        doctorName: `Patient appointment`,
      });
    }

    // Store event IDs for later delete/update
    if (patientEventId || doctorEventId) {
      await prisma.appointment.update({
        where: { id: confirmed.id },
        data: {
          patientCalendarEventId: patientEventId,
          googleCalendarEventId: doctorEventId,
        },
      });
    }

    return res.json({
      message: "Appointment confirmed!",
      appointment: {
        id: confirmed.id,
        status: confirmed.status,
        slotStartTime: confirmed.slot_start_time,
        slotEndTime: confirmed.slot_end_time,
      },
      calendarSynced: !!(patientEventId || doctorEventId),
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
 * Deletes associated Calendar events and creates cancellation notification.
 */
router.post("/:id/cancel", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        doctor: { include: { user: { select: { id: true, name: true } } } },
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

    // Optimistic locking cancel
    const updateResult = await prisma.$queryRawUnsafe(
      `UPDATE appointments
       SET status = 'AVAILABLE',
           patient_id = NULL,
           hold_expires_at = NULL,
           hold_owner_token = NULL,
           notes = NULL,
           google_calendar_event_id = NULL,
           patient_calendar_event_id = NULL,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1
         AND version = $2
       RETURNING id, status`,
      id,
      appointment.version
    );

    if (!updateResult || updateResult.length === 0) {
      return res.status(409).json({
        error: "Conflict: appointment was modified by another request. Please retry.",
      });
    }

    // Create cancellation notification
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

    // ─── Delete Calendar events (fire-and-forget) ────────────────────
    if (appointment.patientCalendarEventId && appointment.patientId) {
      calendarService.deleteEvent(appointment.patientId, appointment.patientCalendarEventId);
    }
    if (appointment.googleCalendarEventId && appointment.doctor?.user?.id) {
      calendarService.deleteEvent(appointment.doctor.user.id, appointment.googleCalendarEventId);
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
 * POST /api/appointments/:id/post-visit
 *
 * Doctor submits clinical notes after a visit. Calls Gemini to generate
 * a patient-friendly summary with medication schedule.
 * Creates medication reminder NotificationJob rows.
 */
router.post("/:id/post-visit", authenticate, authorize("DOCTOR"), async (req, res) => {
  try {
    const { id } = req.params;
    const { clinicalNotes } = req.body;

    if (!clinicalNotes || clinicalNotes.trim().length === 0) {
      return res.status(400).json({ error: "clinicalNotes is required" });
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: { doctor: true },
    });

    if (!appointment) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    if (appointment.status !== "BOOKED") {
      return res.status(409).json({
        error: "Only BOOKED appointments can have post-visit summaries",
      });
    }

    // Verify this doctor owns the appointment
    const doctorProfile = await prisma.doctorProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!doctorProfile || appointment.doctorId !== doctorProfile.id) {
      return res.status(403).json({ error: "Not your appointment" });
    }

    // Call LLM (with graceful fallback)
    const analysis = await generatePostVisitSummary(clinicalNotes, req);

    // Store in PostVisitSummary
    const postVisit = await prisma.postVisitSummary.upsert({
      where: { appointmentId: id },
      update: {
        summary: analysis.patientSummary,
        prescription: JSON.stringify(analysis.medications),
        followUpNotes: JSON.stringify(analysis.followUpSteps),
        llmFailed: analysis.llmFailed,
      },
      create: {
        appointmentId: id,
        summary: analysis.patientSummary,
        prescription: JSON.stringify(analysis.medications),
        followUpNotes: JSON.stringify(analysis.followUpSteps),
        llmFailed: analysis.llmFailed,
      },
    });

    // Mark appointment as COMPLETED
    await prisma.appointment.update({
      where: { id },
      data: { status: "COMPLETED" },
    });

    // ─── Create medication reminder jobs ─────────────────────────────
    if (appointment.patientId && analysis.medications.length > 0) {
      const now = new Date();
      for (const med of analysis.medications) {
        const days = med.durationDays || 7;
        // Create one reminder per day for the duration
        for (let d = 1; d <= days; d++) {
          const scheduledAt = new Date(now);
          scheduledAt.setDate(scheduledAt.getDate() + d);
          scheduledAt.setHours(9, 0, 0, 0); // Schedule for 9 AM

          await prisma.notificationJob.create({
            data: {
              type: "MEDICATION_REMINDER",
              recipientId: appointment.patientId,
              scheduledAt,
              payload: {
                drug: med.drug,
                dosage: med.dosage,
                frequency: med.frequency,
                appointmentId: id,
              },
            },
          });
        }
      }
    }

    return res.json({
      message: analysis.llmFailed
        ? "Post-visit summary saved (AI unavailable, using fallback)"
        : "Post-visit summary generated successfully",
      postVisitSummary: {
        id: postVisit.id,
        patientSummary: analysis.patientSummary,
        medications: analysis.medications,
        followUpSteps: analysis.followUpSteps,
        llmFailed: analysis.llmFailed,
      },
    });
  } catch (err) {
    console.error("Post-visit error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/appointments/my
 * List the current patient's appointments.
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
        symptomSummary: true,
        postVisitSummary: true,
      },
      orderBy: { slotStartTime: "asc" },
    });

    return res.json({
      appointments: appointments.map((a) => {
        let symptomAnalysis = null;
        if (a.symptomSummary) {
          try {
            symptomAnalysis = JSON.parse(a.symptomSummary.summary);
          } catch {
            symptomAnalysis = { chiefComplaint: a.symptomSummary.rawInput };
          }
        }

        let postVisitData = null;
        if (a.postVisitSummary) {
          postVisitData = {
            patientSummary: a.postVisitSummary.summary,
            medications: a.postVisitSummary.prescription
              ? JSON.parse(a.postVisitSummary.prescription)
              : [],
            followUpSteps: a.postVisitSummary.followUpNotes
              ? JSON.parse(a.postVisitSummary.followUpNotes)
              : [],
          };
        }

        return {
          id: a.id,
          doctorName: a.doctor.user.name,
          specialisation: a.doctor.specialisation,
          slotStartTime: a.slotStartTime,
          slotEndTime: a.slotEndTime,
          status: a.status,
          holdExpiresAt: a.holdExpiresAt,
          symptomAnalysis,
          postVisitSummary: postVisitData,
        };
      }),
    });
  } catch (err) {
    console.error("My appointments error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/appointments/doctor
 * Doctor's appointment list, sorted by urgency (High first).
 */
router.get("/doctor", authenticate, authorize("DOCTOR"), async (req, res) => {
  try {
    const doctorProfile = await prisma.doctorProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!doctorProfile) {
      return res.status(404).json({ error: "Doctor profile not found" });
    }

    const appointments = await prisma.appointment.findMany({
      where: {
        doctorId: doctorProfile.id,
        status: { in: ["BOOKED", "COMPLETED"] },
      },
      include: {
        patient: { select: { id: true, name: true, email: true } },
        symptomSummary: true,
        postVisitSummary: true,
      },
      orderBy: { slotStartTime: "asc" },
    });

    // Parse symptom summaries and sort by urgency
    const urgencyOrder = { High: 0, Medium: 1, Low: 2 };
    const mapped = appointments.map((a) => {
      let symptomAnalysis = null;
      let urgency = null;
      if (a.symptomSummary) {
        try {
          symptomAnalysis = JSON.parse(a.symptomSummary.summary);
          urgency = symptomAnalysis.urgency;
        } catch {
          symptomAnalysis = { chiefComplaint: a.symptomSummary.rawInput };
        }
      }

      return {
        id: a.id,
        patientName: a.patient?.name || "N/A",
        patientEmail: a.patient?.email || "N/A",
        slotStartTime: a.slotStartTime,
        slotEndTime: a.slotEndTime,
        status: a.status,
        urgency,
        symptomAnalysis,
        hasPostVisit: !!a.postVisitSummary,
        _urgencySort: urgencyOrder[urgency] ?? 3,
      };
    });

    // Sort: High urgency first, then by time
    mapped.sort((a, b) => {
      if (a._urgencySort !== b._urgencySort) return a._urgencySort - b._urgencySort;
      return new Date(a.slotStartTime) - new Date(b.slotStartTime);
    });

    // Remove internal sort field
    const result = mapped.map(({ _urgencySort, ...rest }) => rest);

    return res.json({ appointments: result });
  } catch (err) {
    console.error("Doctor appointments error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
