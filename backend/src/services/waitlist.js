const crypto = require("crypto");
const prisma = require("../utils/prisma");

/**
 * Checks if there is a pending waitlist entry for a specific doctor and date.
 * If so, automatically holds the given slot for that patient for 1 hour
 * and dispatches a WAITLIST_ALERT email.
 * 
 * @param {string} slotId - The slot ID that just became available
 * @param {string} doctorId - The doctor's ID
 * @param {Date} date - The date of the slot
 * @returns {boolean} - True if waitlist was triggered, false otherwise
 */
async function processWaitlistForSlot(slotId, doctorId, date) {
  // Normalize date to start of day in UTC for matching
  const slotDate = new Date(date);
  slotDate.setUTCHours(0, 0, 0, 0);

  // Find the oldest PENDING waitlist entry for this doctor on this day
  const nextInLine = await prisma.waitlistEntry.findFirst({
    where: {
      doctorId,
      date: slotDate,
      status: "PENDING",
    },
    orderBy: { createdAt: "asc" },
    include: { doctor: { include: { user: true } }, patient: true },
  });

  if (!nextInLine) {
    return false; // No one is waiting
  }

  const holdOwnerToken = crypto.randomUUID();

  // Atomically hold the slot for the waitlist patient for 1 hour
  const updated = await prisma.$queryRawUnsafe(
    `UPDATE appointments
     SET status = 'PENDING_HOLD',
         patient_id = $1,
         hold_expires_at = NOW() + INTERVAL '1 hour',
         hold_owner_token = $2,
         notes = NULL,
         google_calendar_event_id = NULL,
         patient_calendar_event_id = NULL,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $3 AND status = 'AVAILABLE'
     RETURNING id, slot_start_time`,
    nextInLine.patientId,
    holdOwnerToken,
    slotId
  );

  if (!updated || updated.length === 0) {
    // Slot wasn't AVAILABLE (maybe another process grabbed it)
    return false;
  }

  // Mark waitlist entry as NOTIFIED
  await prisma.waitlistEntry.update({
    where: { id: nextInLine.id },
    data: { status: "NOTIFIED" },
  });

  // Enqueue waitlist alert email
  await prisma.notificationJob.create({
    data: {
      type: "WAITLIST_ALERT",
      recipientId: nextInLine.patientId,
      payload: {
        appointmentId: slotId,
        doctorName: nextInLine.doctor.user.name,
        slotStartTime: updated[0].slot_start_time.toISOString(),
        holdOwnerToken,
      },
    },
  });

  console.log(`[Waitlist] Triggered for slot ${slotId}, patient ${nextInLine.patientId}`);
  return true;
}

module.exports = { processWaitlistForSlot };
