/**
 * Reminder Scheduler — creates notification jobs for upcoming appointments
 * and medication reminders.
 *
 * Runs every hour via setInterval:
 * 1. Finds BOOKED appointments 23-25 hours from now → creates EMAIL_REMINDER jobs
 * 2. Finds active medication schedules → creates MEDICATION_REMINDER jobs for today
 */

const prisma = require("../utils/prisma");

const SCHEDULER_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function scheduleReminders() {
  try {
    // ─── 24-hour appointment reminders ─────────────────────────────────
    const now = new Date();
    const reminderStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const reminderEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const upcomingAppointments = await prisma.appointment.findMany({
      where: {
        status: "BOOKED",
        slotStartTime: { gte: reminderStart, lt: reminderEnd },
      },
      include: {
        doctor: { include: { user: { select: { name: true } } } },
        patient: { select: { id: true, name: true } },
      },
    });

    for (const apt of upcomingAppointments) {
      if (!apt.patientId) continue;

      // Check if a reminder already exists for this appointment
      const existing = await prisma.notificationJob.findFirst({
        where: {
          type: "EMAIL_REMINDER",
          recipientId: apt.patientId,
          payload: { path: ["appointmentId"], equals: apt.id },
        },
      });

      if (!existing) {
        await prisma.notificationJob.create({
          data: {
            type: "EMAIL_REMINDER",
            recipientId: apt.patientId,
            payload: {
              appointmentId: apt.id,
              doctorName: apt.doctor.user.name,
              slotStartTime: apt.slotStartTime.toISOString(),
            },
          },
        });
        console.log(`[Reminder] Created 24h reminder for appointment ${apt.id}`);
      }
    }

    // ─── Medication reminders ─────────────────────────────────────────
    // Find post-visit summaries with medication data that were created
    // within the last 30 days and have active prescriptions
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const postVisits = await prisma.postVisitSummary.findMany({
      where: {
        generatedAt: { gte: thirtyDaysAgo },
        llmFailed: false,
      },
      include: {
        appointment: {
          include: {
            patient: { select: { id: true, name: true } },
          },
        },
      },
    });

    const todayStr = now.toISOString().split("T")[0];

    for (const pv of postVisits) {
      if (!pv.appointment.patientId) continue;

      let medications = [];
      try {
        // prescription field stores the raw LLM JSON (medications array)
        if (pv.prescription) {
          const parsed = JSON.parse(pv.prescription);
          medications = Array.isArray(parsed) ? parsed : [];
        }
      } catch {
        continue; // Skip if prescription isn't valid JSON
      }

      for (const med of medications) {
        if (!med.drug || !med.durationDays) continue;

        // Check if medication is still within the duration period
        const startDate = new Date(pv.generatedAt);
        const endDate = new Date(startDate.getTime() + med.durationDays * 24 * 60 * 60 * 1000);

        if (now > endDate) continue; // Prescription has ended

        // Check if we already created a reminder for this med today
        const existingMedReminder = await prisma.notificationJob.findFirst({
          where: {
            type: "MEDICATION_REMINDER",
            recipientId: pv.appointment.patientId,
            createdAt: { gte: new Date(todayStr + "T00:00:00.000Z") },
            payload: {
              path: ["drug"],
              equals: med.drug,
            },
          },
        });

        if (!existingMedReminder) {
          await prisma.notificationJob.create({
            data: {
              type: "MEDICATION_REMINDER",
              recipientId: pv.appointment.patientId,
              payload: {
                drug: med.drug,
                dosage: med.dosage || "As prescribed",
                frequency: med.frequency || "As prescribed",
                appointmentId: pv.appointmentId,
              },
            },
          });
          console.log(`[Reminder] Created medication reminder for ${med.drug}`);
        }
      }
    }
  } catch (err) {
    console.error("[Reminder] Scheduler error:", err.message);
  }
}

function startReminderScheduler() {
  console.log(
    `[Reminder] Starting scheduler (every ${SCHEDULER_INTERVAL_MS / 1000 / 60} min)`
  );
  // Run once on startup
  scheduleReminders();
  return setInterval(scheduleReminders, SCHEDULER_INTERVAL_MS);
}

module.exports = { startReminderScheduler, scheduleReminders };
