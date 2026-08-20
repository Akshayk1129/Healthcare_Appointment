const express = require("express");
const prisma = require("../utils/prisma");

const router = express.Router();

/**
 * GET /api/doctors?specialisation=X
 * Search doctors by specialisation (case-insensitive partial match).
 * Public endpoint — no auth required.
 */
router.get("/", async (req, res) => {
  try {
    const { specialisation } = req.query;

    const where = {};
    if (specialisation) {
      where.specialisation = {
        contains: specialisation,
        mode: "insensitive",
      };
    }

    const doctors = await prisma.doctorProfile.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { specialisation: "asc" },
    });

    return res.json({
      doctors: doctors.map((d) => ({
        id: d.id,
        name: d.user.name,
        email: d.user.email,
        specialisation: d.specialisation,
        slotDurationMinutes: d.slotDurationMinutes,
        workingHours: d.workingHours,
      })),
    });
  } catch (err) {
    console.error("Search doctors error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/doctors/:id/slots?date=YYYY-MM-DD
 * List AVAILABLE slots for a doctor.
 * If date is provided, returns slots for that date only.
 * Otherwise returns slots for the next 7 days.
 * Public endpoint — no auth required.
 */
router.get("/:id/slots", async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;

    const profile = await prisma.doctorProfile.findUnique({ where: { id } });
    if (!profile) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    let startDate, endDate;
    if (date) {
      startDate = new Date(date + "T00:00:00.000Z");
      endDate = new Date(date + "T00:00:00.000Z");
      endDate.setDate(endDate.getDate() + 1);
    } else {
      startDate = new Date();
      endDate = new Date();
      endDate.setDate(endDate.getDate() + 7);
    }

    const slots = await prisma.appointment.findMany({
      where: {
        doctorId: id,
        status: "AVAILABLE",
        slotStartTime: { gte: startDate, lt: endDate },
      },
      orderBy: { slotStartTime: "asc" },
      select: {
        id: true,
        slotStartTime: true,
        slotEndTime: true,
        status: true,
      },
    });

    return res.json({ slots });
  } catch (err) {
    console.error("List slots error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
