/**
 * Hold Expiry Sweep Job
 *
 * Runs on a setInterval (every 30 seconds) and resets any PENDING_HOLD
 * appointment whose holdExpiresAt has passed back to AVAILABLE.
 *
 * This is a single atomic UPDATE — no SELECT-then-UPDATE race conditions.
 */

const prisma = require("../utils/prisma");

const SWEEP_INTERVAL_MS = 30 * 1000; // 30 seconds

async function sweepExpiredHolds() {
  try {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE appointments
       SET status = 'AVAILABLE',
           patient_id = NULL,
           hold_expires_at = NULL,
           hold_owner_token = NULL,
           version = version + 1,
           updated_at = NOW()
       WHERE status = 'PENDING_HOLD'
         AND hold_expires_at < NOW()`
    );

    if (result > 0) {
      console.log(`[HoldExpiry] Cleaned up ${result} expired hold(s)`);
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
