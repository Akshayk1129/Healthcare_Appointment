

async function testCreateDoctor() {
  const token = process.env.TEST_TOKEN || ""; // I need an admin token
  
  const payload = {
    name: 'Test Doc',
    email: 'testdoc1@test.com',
    password: 'password123',
    specialisation: 'Testing',
    slotDurationMinutes: 30,
    workingHours: {
      mon: { start: "09:00", end: "17:00" },
      tue: { start: "09:00", end: "17:00" },
      wed: { start: "09:00", end: "17:00" },
      thu: { start: "09:00", end: "17:00" },
      fri: { start: "09:00", end: "17:00" },
      sat: { start: "09:00", end: "13:00" },
    }
  };
  
  // Login as admin first
  const loginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@healthcare.com', password: 'admin123' })
  });
  
  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    console.log("Login failed:", loginData);
    return;
  }
  const adminToken = loginData.token;
  
  const res = await fetch('http://localhost:5000/api/admin/doctors', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify(payload)
  });
  
  console.log("Status:", res.status);
  console.log("Response:", await res.json());
}

testCreateDoctor();
