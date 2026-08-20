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
    // Find pending jobs that are due
    const jobs = await prisma.notificationJob.findMany({
      where: {
        status: "PENDING",
        OR: [
          { scheduledAt: null },
          { scheduledAt: { lte: new Date() } },
        ],
      },
      include: {
        recipient: { select: { email: true, name: true } },
      },
      take: 10, // Process up to 10 jobs per cycle
      orderBy: { createdAt: "asc" },
    });

    if (jobs.length === 0) return;

    console.log(`[NotificationWorker] Processing ${jobs.length} job(s)`);

    for (const job of jobs) {
      try {
        // Check exponential backoff: skip if too recent after a failure
        if (job.attempts > 0) {
          const backoffMs = Math.pow(2, job.attempts) * 60 * 1000;
          const nextRetryAt = new Date(job.updatedAt.getTime() + backoffMs);
          if (new Date() < nextRetryAt) continue;
        }

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
          const newStatus = newAttempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING";

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
            status: newAttempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
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
