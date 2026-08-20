/**
 * Concurrency Test Script
 *
 * Proves that the atomic compare-and-swap hold mechanism works correctly:
 * fires 10 simultaneous hold requests at the SAME slot, and verifies
 * that exactly 1 succeeds and 9 fail.
 *
 * Usage: node scripts/concurrency-test.js [BASE_URL]
 * Default BASE_URL: http://localhost:5000
 */

const BASE_URL = process.argv[2] || "http://localhost:5000";

async function request(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  return { status: res.status, data };
}

async function main() {
  console.log("=".repeat(60));
  console.log("CONCURRENCY TEST — Slot Hold Race Condition");
  console.log("=".repeat(60));
  console.log(`Target: ${BASE_URL}`);
  console.log();

  // Step 1: Login as admin
  console.log("[1] Logging in as admin...");
  const adminLogin = await request("POST", "/api/auth/login", {
    email: "admin@healthcare.com",
    password: "admin123",
  });

  if (adminLogin.status !== 200) {
    console.error("Admin login failed. Run the seed script first.");
    console.error(adminLogin.data);
    process.exit(1);
  }
  const adminToken = adminLogin.data.token;
  console.log("    Admin login OK");

  // Step 2: Create a test doctor
  console.log("[2] Creating test doctor...");
  const doctorRes = await request(
    "POST",
    "/api/admin/doctors",
    {
      email: `testdoc-${Date.now()}@test.com`,
      password: "test123",
      name: "Dr. Concurrency Test",
      specialisation: "Testing",
      workingHours: {
        mon: { start: "09:00", end: "17:00" },
        tue: { start: "09:00", end: "17:00" },
        wed: { start: "09:00", end: "17:00" },
        thu: { start: "09:00", end: "17:00" },
        fri: { start: "09:00", end: "17:00" },
        sat: { start: "09:00", end: "13:00" },
      },
      slotDurationMinutes: 30,
    },
    adminToken
  );

  if (doctorRes.status !== 201) {
    console.error("Failed to create doctor:", doctorRes.data);
    process.exit(1);
  }
  const doctorId = doctorRes.data.doctor.id;
  console.log(`    Doctor created: ${doctorId}`);

  // Step 3: Generate slots
  console.log("[3] Generating slots...");
  const slotsRes = await request(
    "POST",
    `/api/admin/doctors/${doctorId}/generate-slots`,
    { days: 7 },
    adminToken
  );
  console.log(`    ${slotsRes.data.message}`);

  // Step 4: Find an available slot
  console.log("[4] Finding an available slot...");
  const availableRes = await request("GET", `/api/doctors/${doctorId}/slots`);
  const slots = availableRes.data.slots;

  if (!slots || slots.length === 0) {
    console.error("No available slots found!");
    process.exit(1);
  }
  const targetSlot = slots[0];
  console.log(`    Target slot: ${targetSlot.id} (${targetSlot.slotStartTime})`);

  // Step 5: Register 10 test patients
  console.log("[5] Registering 10 test patients...");
  const patients = [];
  for (let i = 0; i < 10; i++) {
    const regRes = await request("POST", "/api/auth/register", {
      email: `patient-${Date.now()}-${i}@test.com`,
      password: "test123",
      name: `Patient ${i}`,
    });
    if (regRes.status === 201) {
      patients.push(regRes.data.token);
    }
  }
  console.log(`    Registered ${patients.length} patients`);

  // Step 6: Fire 10 SIMULTANEOUS hold requests
  console.log("[6] Firing 10 simultaneous hold requests...");
  console.log(`    Target slot: ${targetSlot.id}`);
  console.log();

  const results = await Promise.all(
    patients.map((token, i) =>
      request("POST", `/api/appointments/${targetSlot.id}/hold`, {}, token).then(
        (r) => ({ patient: i, ...r })
      )
    )
  );

  // Step 7: Analyze results
  const successes = results.filter((r) => r.status === 200);
  const failures = results.filter((r) => r.status !== 200);

  console.log("-".repeat(60));
  console.log("RESULTS:");
  console.log("-".repeat(60));

  for (const r of results) {
    const icon = r.status === 200 ? "✅" : "❌";
    const msg = r.status === 200 ? "HOLD ACQUIRED" : r.data.error;
    console.log(`  Patient ${r.patient}: ${icon} [${r.status}] ${msg}`);
  }

  console.log();
  console.log("-".repeat(60));
  console.log(`SUMMARY: ${successes.length} succeeded, ${failures.length} failed`);
  console.log("-".repeat(60));

  if (successes.length === 1 && failures.length === 9) {
    console.log("✅ PASS — Exactly 1 hold succeeded, 9 were correctly rejected.");
    console.log("   Double-booking is prevented at the database level.");
  } else if (successes.length === 0) {
    console.log("⚠️  UNEXPECTED — 0 succeeded. The slot may have been in the wrong state.");
  } else if (successes.length > 1) {
    console.log("❌ FAIL — Multiple holds succeeded! Double-booking vulnerability detected.");
  }

  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
