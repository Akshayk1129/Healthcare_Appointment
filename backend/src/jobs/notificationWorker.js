/**
 * Notification Worker — processes the NotificationJob queue
 *
 * Runs on setInterval (every 60 seconds):
 * 1. Finds PENDING jobs where scheduledAt <= now (or scheduledAt is null)
 * 2. Attempts to send email via the email service
 * 3. On success: marks SENT, sets sentAt
 * 4. On failure: increments attempts, stores lastError
 * 5. If attempts >= 3: marks FAILED
 * 6. Exponential backoff: skips recently-failed jobs
 */

const prisma = require("../utils/prisma");
const { sendEmail } = require("../services/email");

const WORKER_INTERVAL_MS = 60 * 1000; // 60 seconds
const MAX_ATTEMPTS = 3;

async function processNotificationJobs() {
  try {
    // Atomically claim up to 10 jobs that are due and respect exponential backoff
    const lockedRows = await prisma.$queryRawUnsafe(`
      UPDATE notification_jobs
      SET status = 'PROCESSING', updated_at = NOW()
      WHERE id IN (
        SELECT id FROM notification_jobs
        WHERE status IN ('PENDING', 'RETRYING')
          AND (scheduled_at IS NULL OR scheduled_at <= NOW())
          AND (
            status = 'PENDING' OR 
            NOW() >= updated_at + (POWER(2, attempts) * INTERVAL '1 minute')
          )
        ORDER BY created_at ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `);

    if (!lockedRows || lockedRows.length === 0) return;

    const jobIds = lockedRows.map((r) => r.id);

    // Fetch full job data including recipient
    const jobs = await prisma.notificationJob.findMany({
      where: { id: { in: jobIds } },
      include: {
        recipient: { select: { email: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    console.log(`[NotificationWorker] Processing ${jobs.length} job(s)`);

    for (const job of jobs) {
      console.log(`[NotificationWorker] Claimed job ${job.id} (${job.type})`);
      try {
        const result = await sendEmail(
          job.type,
          job.recipient.email,
          job.recipient.name,
          job.payload
        );

        if (result.success) {
          await prisma.notificationJob.update({
            where: { id: job.id },
            data: {
              status: "SENT",
              sentAt: new Date(),
              attempts: job.attempts + 1,
            },
          });
          console.log(`[NotificationWorker] Job ${job.id} SENT (${job.type})`);
        } else {
          const newAttempts = job.attempts + 1;
          const newStatus = newAttempts >= MAX_ATTEMPTS ? "FAILED" : "RETRYING";

          await prisma.notificationJob.update({
            where: { id: job.id },
            data: {
              status: newStatus,
              attempts: newAttempts,
              lastError: result.error,
            },
          });

          console.log(
            `[NotificationWorker] Job ${job.id} attempt ${newAttempts}/${MAX_ATTEMPTS} failed: ${result.error}`
          );
        }
      } catch (err) {
        // Individual job error — don't crash the whole batch
        const newAttempts = job.attempts + 1;
        await prisma.notificationJob.update({
          where: { id: job.id },
          data: {
            status: newAttempts >= MAX_ATTEMPTS ? "FAILED" : "RETRYING",
            attempts: newAttempts,
            lastError: err.message,
          },
        });
        console.error(`[NotificationWorker] Job ${job.id} error:`, err.message);
      }
    }
  } catch (err) {
    console.error("[NotificationWorker] Worker error:", err.message);
  }
}

function startNotificationWorker() {
  console.log(
    `[NotificationWorker] Starting worker (every ${WORKER_INTERVAL_MS / 1000}s)`
  );
  // Run once immediately
  processNotificationJobs();
  return setInterval(processNotificationJobs, WORKER_INTERVAL_MS);
}

module.exports = { startNotificationWorker, processNotificationJobs };
