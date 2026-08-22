/**
 * Hold Expiry Sweep Job
 *
 * Runs on a setInterval (every 30 seconds) and resets any PENDING_HOLD
 * appointment whose holdExpiresAt has passed back to AVAILABLE.
 *
 * This is a single atomic UPDATE — no SELECT-then-UPDATE race conditions.
 */

const prisma = require("../utils/prisma");
const { processWaitlistForSlot } = require("../services/waitlist");

const SWEEP_INTERVAL_MS = 30 * 1000; // 30 seconds

async function sweepExpiredHolds() {
  try {
    const expiredSlots = await prisma.$queryRawUnsafe(
      `UPDATE appointments
       SET status = 'AVAILABLE',
           patient_id = NULL,
           hold_expires_at = NULL,
           hold_owner_token = NULL,
           version = version + 1,
           updated_at = NOW()
       WHERE status = 'PENDING_HOLD'
         AND hold_expires_at < NOW()
       RETURNING id, doctor_id, slot_start_time, patient_id`
    );

    if (expiredSlots && expiredSlots.length > 0) {
      console.log(`[HoldExpiry] Cleaned up ${expiredSlots.length} expired hold(s)`);
      
      // If this was a waitlist hold, mark the old waitlist entry as EXPIRED
      // because we already marked it NOTIFIED when we gave them the hold.
      // Wait, we need the waitlistEntry ID, or we can just find NOTIFIED entry.
      for (const slot of expiredSlots) {
        if (slot.patient_id) {
           await prisma.waitlistEntry.updateMany({
             where: {
               patientId: slot.patient_id,
               doctorId: slot.doctor_id,
               status: "NOTIFIED"
             },
             data: { status: "EXPIRED" }
           });
        }
        
        // Trigger waitlist for the next person
        await processWaitlistForSlot(slot.id, slot.doctor_id, slot.slot_start_time);
      }
    }
  } catch (err) {
    console.error("[HoldExpiry] Sweep error:", err.message);
  }
}

function startHoldExpirySweep() {
  console.log(
    `[HoldExpiry] Starting sweep job (every ${SWEEP_INTERVAL_MS / 1000}s)`
  );
  // Run once immediately on startup
  sweepExpiredHolds();
  // Then at regular intervals
  return setInterval(sweepExpiredHolds, SWEEP_INTERVAL_MS);
}

module.exports = { startHoldExpirySweep, sweepExpiredHolds };
