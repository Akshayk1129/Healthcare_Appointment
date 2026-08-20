import { useState, useEffect } from 'react'

export default function DoctorDashboard() {
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [postVisitId, setPostVisitId] = useState(null)
  const [clinicalNotes, setClinicalNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [postVisitResult, setPostVisitResult] = useState(null)

  const token = localStorage.getItem('token')
  const apiUrl = import.meta.env.VITE_API_URL || ''

  const fetchAppointments = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiUrl}/api/appointments/doctor`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await res.json()
      setAppointments(data.appointments || [])
    } catch {
      setAppointments([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token) fetchAppointments()
  }, [])

  const submitPostVisit = async (appointmentId) => {
    if (!clinicalNotes.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch(`${apiUrl}/api/appointments/${appointmentId}/post-visit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ clinicalNotes }),
      })
      const data = await res.json()
      if (res.ok) {
        setPostVisitResult(data.postVisitSummary)
        fetchAppointments() // Refresh to show COMPLETED
      } else {
        alert(`Error: ${data.error}`)
      }
    } catch {
      alert('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  const formatTime = (iso) => {
    const d = new Date(iso)
    return d.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const urgencyColors = {
    High: { bg: 'rgba(248, 113, 113, 0.12)', color: '#f87171' },
    Medium: { bg: 'rgba(251, 191, 36, 0.12)', color: '#fbbf24' },
    Low: { bg: 'rgba(52, 211, 153, 0.12)', color: '#34d399' },
  }

  return (
    <div className="page">
      <h1>Doctor Dashboard</h1>
      <p className="page-subtitle">Appointments sorted by urgency (High → Low)</p>

      {loading ? (
        <p className="empty-state">Loading...</p>
      ) : appointments.length === 0 ? (
        <p className="empty-state">No appointments yet.</p>
      ) : (
        <div className="appointments-list">
          {appointments.map((apt) => (
            <div key={apt.id} className="appointment-card doctor-apt-card">
              <div className="appointment-info">
                <div className="apt-header-row">
                  <h3>{apt.patientName}</h3>
                  {apt.urgency && (
                    <span
                      className="urgency-pill"
                      style={{
                        background: urgencyColors[apt.urgency]?.bg,
                        color: urgencyColors[apt.urgency]?.color,
                      }}
                    >
                      {apt.urgency} Urgency
                    </span>
                  )}
                  <span className={`status-badge ${apt.status === 'COMPLETED' ? 'status-completed' : 'status-booked'}`}>
                    {apt.status}
                  </span>
                </div>
                <p className="appointment-time">{formatTime(apt.slotStartTime)}</p>

                {/* Symptom Summary */}
                {apt.symptomAnalysis && (
                  <div className="symptom-preview">
                    <strong>Chief complaint:</strong> {apt.symptomAnalysis.chiefComplaint}
                    {apt.symptomAnalysis.suggestedQuestions?.length > 0 && (
                      <div className="suggested-questions">
                        <strong>Suggested questions:</strong>
                        <ul>
                          {apt.symptomAnalysis.suggestedQuestions.map((q, i) => (
                            <li key={i}>{q}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="appointment-actions">
                {apt.status === 'BOOKED' && !apt.hasPostVisit && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setPostVisitId(postVisitId === apt.id ? null : apt.id)
                      setClinicalNotes('')
                      setPostVisitResult(null)
                    }}
                  >
                    {postVisitId === apt.id ? 'Close' : 'Post-Visit Notes'}
                  </button>
                )}
                {apt.hasPostVisit && (
                  <span className="badge">✅ Summary done</span>
                )}
              </div>

              {/* Post-visit form */}
              {postVisitId === apt.id && (
                <div className="post-visit-form">
                  <h4>Clinical Notes & Prescription</h4>
                  <textarea
                    value={clinicalNotes}
                    onChange={(e) => setClinicalNotes(e.target.value)}
                    placeholder="E.g., Patient presents with tension headache. Prescribed Ibuprofen 400mg twice daily for 5 days. Follow up in 1 week if symptoms persist."
                    rows={4}
                    className="symptoms-input"
                  />
                  <button
                    className="btn btn-primary"
                    onClick={() => submitPostVisit(apt.id)}
                    disabled={submitting || !clinicalNotes.trim()}
                  >
                    {submitting ? 'Generating summary...' : 'Generate Patient Summary'}
                  </button>

                  {postVisitResult && (
                    <div className="post-visit-result">
                      <h4>Patient-Friendly Summary</h4>
                      <p>{postVisitResult.patientSummary}</p>
                      {postVisitResult.medications?.length > 0 && (
                        <div>
                          <h5>Medications:</h5>
                          <ul>
                            {postVisitResult.medications.map((m, i) => (
                              <li key={i}>
                                <strong>{m.drug}</strong> — {m.dosage}, {m.frequency} for {m.durationDays} days
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {postVisitResult.followUpSteps?.length > 0 && (
                        <div>
                          <h5>Follow-up Steps:</h5>
                          <ul>
                            {postVisitResult.followUpSteps.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {postVisitResult.llmFailed && (
                        <p className="symptom-fallback">⚠️ AI summary unavailable — raw notes saved</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
