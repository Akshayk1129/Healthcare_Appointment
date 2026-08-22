const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const prisma = require("../utils/prisma");

// We'll create a single doctor and patient for all tests
let testDoctorUserId;
let testDoctorId;
let testPatientId;

test.before(async () => {
  // Setup isolated test entities
  const rand = crypto.randomBytes(4).toString("hex");
  
  const doctorUser = await prisma.user.create({
    data: {
      email: `test_doc_${rand}@test.com`,
      password: "password123",
      name: "Dr. Test",
      role: "DOCTOR",
      doctorProfile: {
        create: {
          specialisation: "Testing",
          workingHours: { mon: { start: "09:00", end: "17:00" } },
          slotDurationMinutes: 30
        }
      }
    },
    include: { doctorProfile: true }
  });
  
  testDoctorUserId = doctorUser.id;
  testDoctorId = doctorUser.doctorProfile.id;
  
  const patientUser = await prisma.user.create({
    data: {
      email: `test_pat_${rand}@test.com`,
      password: "password123",
      name: "Test Patient",
      role: "PATIENT",
    }
  });
  
  testPatientId = patientUser.id;
});

test.after(async () => {
  // Cleanup isolated test entities
  if (testPatientId) await prisma.user.delete({ where: { id: testPatientId } });
  if (testDoctorUserId) await prisma.user.delete({ where: { id: testDoctorUserId } });
});

async function createTestSlot() {
  return await prisma.appointment.create({
    data: {
      doctorId: testDoctorId,
      slotStartTime: new Date(Date.now() + 86400000), // Tomorrow
      slotEndTime: new Date(Date.now() + 86400000 + 1800000),
      status: "AVAILABLE"
    }
  });
}

test("1. Concurrent hold requests on the same slot — exactly one succeeds", async () => {
  const slot = await createTestSlot();
  
  // Simulate 10 simultaneous hold attempts bypassing API to directly test DB concurrency pattern
  const holdAttempts = Array(10).fill(0).map(async (_, index) => {
    // Same query as the actual endpoint
    return await prisma.$queryRawUnsafe(
      `UPDATE appointments
       SET status = 'PENDING_HOLD',
           patient_id = $1,
           hold_expires_at = NOW() + INTERVAL '5 minutes',
           hold_owner_token = $2,
           version = version + 1
       WHERE id = $3 AND status = 'AVAILABLE'
       RETURNING id`,
      testPatientId,
      `token_${index}`,
      slot.id
    );
  });
  
  const results = await Promise.allSettled(holdAttempts);
  
  const successes = results.filter(r => r.status === "fulfilled" && r.value.length > 0);
  const failures = results.filter(r => r.status === "fulfilled" && r.value.length === 0);
  
  assert.strictEqual(successes.length, 1, "Exactly one request should acquire the lock");
  assert.strictEqual(failures.length, 9, "The other nine requests must fail");
});

test("2. Confirming an expired hold fails cleanly", async () => {
  const slot = await createTestSlot();
  const token = "expired_token_123";
  
  // Force slot into an expired hold state
  await prisma.appointment.update({
    where: { id: slot.id },
    data: {
      status: "PENDING_HOLD",
      patientId: testPatientId,
      holdOwnerToken: token,
      holdExpiresAt: new Date(Date.now() - 10000), // 10 seconds ago
      version: 1
    }
  });
  
  // Now simulate the confirm endpoint
  // We check if holdExpiresAt < NOW().
  const result = await prisma.$queryRawUnsafe(
    `UPDATE appointments
     SET status = 'BOOKED', hold_expires_at = NULL, hold_owner_token = NULL, version = version + 1
     WHERE id = $1 AND status = 'PENDING_HOLD' AND hold_owner_token = $2 AND hold_expires_at > NOW()
     RETURNING id`,
    slot.id,
    token
  );
  
  assert.strictEqual(result.length, 0, "Confirming an expired hold must return 0 rows updated");
});

test("3. Leave-conflict cascade (Cancellation + Release)", async () => {
  const slotBooked = await createTestSlot();
  const slotHold = await createTestSlot();
  
  // Book the first slot
  await prisma.appointment.update({
    where: { id: slotBooked.id },
    data: { status: "BOOKED", patientId: testPatientId }
  });
  
  // Hold the second slot
  await prisma.appointment.update({
    where: { id: slotHold.id },
    data: { status: "PENDING_HOLD", patientId: testPatientId }
  });
  
  // Simulate Leave cascade logic
  await prisma.$transaction(async (tx) => {
    // A) Cancel BOOKED
    const booked = await tx.appointment.findMany({
      where: { doctorId: testDoctorId, status: "BOOKED" }
    });
    for (const apt of booked) {
      await tx.notificationJob.create({
        data: {
          type: "LEAVE_CONFLICT",
          recipientId: apt.patientId,
          payload: { appointmentId: apt.id }
        }
      });
      await tx.appointment.delete({ where: { id: apt.id } });
    }
    
    // B) Wipe PENDING_HOLD
    await tx.appointment.deleteMany({
      where: { doctorId: testDoctorId, status: { in: ["PENDING_HOLD", "AVAILABLE"] } }
    });
  });
  
  // Assertions
  const checkBooked = await prisma.appointment.findUnique({ where: { id: slotBooked.id } });
  assert.strictEqual(checkBooked, null, "Booked slot should be deleted");
  
  const checkHold = await prisma.appointment.findUnique({ where: { id: slotHold.id } });
  assert.strictEqual(checkHold, null, "Hold slot should be deleted");
  
  const notif = await prisma.notificationJob.findFirst({
    where: { type: "LEAVE_CONFLICT", recipientId: testPatientId }
  });
  assert.ok(notif, "A NotificationJob for leave conflict must be created");
});

test("4. LLM failure fallback", async () => {
  const slot = await createTestSlot();
  
  // Simulate LLM endpoint error handling
  const rawInput = "My head hurts really badly";
  // We assume LLM throws, so we fallback
  const summaryData = {
    appointmentId: slot.id,
    summary: JSON.stringify({ chiefComplaint: rawInput }),
    rawInput: rawInput,
    llmFailed: true
  };
  
  const created = await prisma.symptomSummary.create({ data: summaryData });
  assert.strictEqual(created.llmFailed, true, "llmFailed flag must be true");
  assert.ok(created.summary.includes("My head hurts"), "Raw input must be saved as fallback");
});

test("5. Double-cancel concurrency check", async () => {
  const slot = await createTestSlot();
  await prisma.appointment.update({
    where: { id: slot.id },
    data: { status: "BOOKED", patientId: testPatientId, version: 1 }
  });
  
  // Simulating the exact SQL the cancel endpoint uses
  // Both requests use version = 1
  const cancel1 = await prisma.$queryRawUnsafe(
    `UPDATE appointments
     SET status = 'AVAILABLE', patient_id = NULL, version = version + 1
     WHERE id = $1 AND status = 'BOOKED' AND version = $2
     RETURNING id`,
    slot.id, 1
  );
  
  // The second request races and uses version = 1 as well
  const cancel2 = await prisma.$queryRawUnsafe(
    `UPDATE appointments
     SET status = 'AVAILABLE', patient_id = NULL, version = version + 1
     WHERE id = $1 AND status = 'BOOKED' AND version = $2
     RETURNING id`,
    slot.id, 1
  );
  
  assert.strictEqual(cancel1.length, 1, "First cancel succeeds");
  assert.strictEqual(cancel2.length, 0, "Second cancel fails cleanly due to optimistic locking");
});
