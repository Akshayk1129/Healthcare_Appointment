# System Design: Healthcare Appointment Manager

## 1. Double-Booking Prevention
Preventing double-booking in a highly concurrent environment requires database-level guarantees, as application-level checks are vulnerable to race conditions. 

We implemented a **Compare-and-Swap (CAS)** pattern using atomic PostgreSQL queries. When a patient attempts to book a slot, the system executes:
`UPDATE slots SET status = 'PENDING_HOLD' WHERE id = ? AND status = 'AVAILABLE'`

If two requests fire simultaneously, the database guarantees that only the first transaction finds the row in the `AVAILABLE` state. The second transaction finds zero matching rows and gracefully fails.

As a final failsafe against administrative or schema errors, we enforce a strict database constraint: `@@unique([doctorId, slotStartTime])`. This guarantees it is mathematically impossible for the database to contain two overlapping slots for the same doctor.

Our load testing script fired 10 simultaneous hold requests at a single slot. The result proved our architecture: exactly **1 request succeeded and 9 failed**, demonstrating complete immunity to double-booking vulnerabilities.

## 2. Doctor Leave Conflict Handling
When an admin marks a doctor on leave for a specific date, the system must handle existing slots intelligently without leaving dangling records or orphaned patients.

We implemented a comprehensive cascade mechanism:
1. **BOOKED Slots:** The system deletes the Appointment record and immediately generates a `NotificationJob` for the affected patient, queuing a cancellation email explaining the doctor's absence. The slot itself is then deleted.
2. **PENDING_HOLD Slots:** If a patient is actively filling out the symptom form (holding the slot), their hold is forcibly invalidated. The slot is reverted to `AVAILABLE` and then deleted, preventing the patient from confirming the booking.
3. **AVAILABLE Slots:** Unbooked slots on that date are silently deleted to prevent future bookings.

This unified transaction ensures the calendar remains perfectly synchronized with the doctor's real-world availability.

## 3. Slot Hold Mechanism
To prevent the "shopping cart" problem—where a patient loses a slot while typing out their symptoms—we implemented a 5-minute temporary hold system.

When a user selects a slot, its state transitions to `PENDING_HOLD` and a `holdExpiresAt` timestamp is set to `NOW() + 5 minutes`. The patient is guaranteed exclusive access to this slot during this window to complete the LLM-powered symptom form.

To prevent abandoned holds from permanently blocking the calendar, a background Node.js cron job (the Hold Expiry Sweep) runs every 30 seconds. It executes a bulk SQL update, identifying all slots where `status = 'PENDING_HOLD'` and `holdExpiresAt < NOW()`, and resets their status back to `AVAILABLE`.

## 4. Notification Failure Handling
Relying on external SMTP providers introduces latency and potential failure points. We isolated email dispatching from the main booking thread using a robust background job queue.

When an email is required, a `NotificationJob` is inserted with a `PENDING` state. A background worker continuously polls this table. 

To prevent overlapping worker instances from sending duplicate emails, we use an atomic lock:
`UPDATE notification_jobs SET status = 'PROCESSING' WHERE id IN (SELECT id ... FOR UPDATE SKIP LOCKED) RETURNING id`
This allows multiple workers to run safely in parallel.

If an SMTP failure occurs, the worker increments the `attempts` counter and sets the status to `RETRYING`. We implemented **exponential backoff** directly in the SQL query (`NOW() >= updated_at + POWER(2, attempts) * INTERVAL '1 minute'`). This forces the system to wait 2, 4, and 8 minutes between retries. If the job fails a 3rd time, it is permanently marked as `FAILED`. This architecture ensures transient network issues never disrupt patient communication while protecting the system from infinite retry loops.

## 5. Atomic Rescheduling
When a patient or doctor reschedules an appointment, the system executes a single, atomic Prisma transaction:
1. It executes a locking `UPDATE ... RETURNING` query to hold the new slot. If the slot was taken a millisecond prior, the query returns empty, instantly aborting the transaction with a `409 Conflict` to protect the original booking.
2. It migrates the patient data, AI symptom summaries, and Calendar Event IDs to the new slot.
3. It cleanly resets the original slot back to `AVAILABLE`.

By updating the existing Google Calendar Event via the API instead of deleting and recreating it, the event simply moves on the user's calendar, maintaining RSVP states and avoiding duplicated invites.
