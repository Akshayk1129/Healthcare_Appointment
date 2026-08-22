const PDFDocument = require("pdfkit");

/**
 * Generates a Medical Records PDF and streams it to the HTTP response.
 *
 * @param {Object} user - The patient user object
 * @param {Array} appointments - Array of COMPLETED appointments with doctor and postVisitSummary
 * @param {Object} res - The Express response object
 */
function generateMedicalRecordsPDF(user, appointments, res) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });

      // Pipe its output to the response
      doc.pipe(res);

      // --- Header ---
      doc
        .fillColor("#4CAF50")
        .fontSize(24)
        .text("Official Medical Records", { align: "center" })
        .moveDown(0.5);

      doc
        .fillColor("#000000")
        .fontSize(10)
        .text(`Generated on: ${new Date().toLocaleString()}`, { align: "center" })
        .moveDown(2);

      // --- Patient Info ---
      doc.fontSize(14).text("Patient Information", { underline: true }).moveDown(0.5);
      doc.fontSize(12).text(`Name: ${user.name}`);
      doc.text(`Email: ${user.email}`);
      if (user.phone) doc.text(`Phone: ${user.phone}`);
      doc.moveDown(2);

      // --- Appointment History ---
      doc.fontSize(14).text("Visit History & Clinical Notes", { underline: true }).moveDown(1);

      if (!appointments || appointments.length === 0) {
        doc.fontSize(12).text("No completed appointments found on record.");
      } else {
        appointments.forEach((appt, index) => {
          doc.fontSize(12).fillColor("#333333").text(`Visit #${index + 1}`, { underline: true });
          doc.fontSize(10).fillColor("#555555").text(`Date: ${new Date(appt.slotStartTime).toLocaleString()}`);
          doc.text(`Doctor: ${appt.doctor.user.name} (${appt.doctor.specialisation})`);
          doc.moveDown(0.5);

          if (appt.postVisitSummary) {
            // Patient Summary
            if (appt.postVisitSummary.summary) {
              doc.fontSize(11).fillColor("#000000").text("Clinical Summary:", { underline: true });
              doc.fontSize(10).text(appt.postVisitSummary.summary, { align: "justify" });
              doc.moveDown(0.5);
            }

            // Prescriptions
            if (appt.postVisitSummary.prescription) {
              try {
                const meds = JSON.parse(appt.postVisitSummary.prescription);
                if (meds && meds.length > 0) {
                  doc.fontSize(11).text("Prescriptions:", { underline: true });
                  meds.forEach((med) => {
                    doc.fontSize(10).text(`• ${med.drug} - ${med.dosage} (${med.frequency}) for ${med.durationDays} days`);
                  });
                  doc.moveDown(0.5);
                }
              } catch (e) {
                // Ignore parse errors for fallback data
              }
            }

            // Follow-up Notes
            if (appt.postVisitSummary.followUpNotes) {
              try {
                const steps = JSON.parse(appt.postVisitSummary.followUpNotes);
                if (steps && steps.length > 0) {
                  doc.fontSize(11).text("Follow-up Instructions:", { underline: true });
                  steps.forEach((step) => {
                    doc.fontSize(10).text(`• ${step}`);
                  });
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          } else {
            doc.fontSize(10).text("No clinical notes recorded for this visit.");
          }

          doc.moveDown(2);
          
          // Add a line separator if not the last item
          if (index < appointments.length - 1) {
            doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor("#cccccc").stroke();
            doc.moveDown(2);
          }
        });
      }

      // Finalize PDF file
      doc.end();
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateMedicalRecordsPDF };
