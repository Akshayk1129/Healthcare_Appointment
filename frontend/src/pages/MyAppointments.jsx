import { useState, useEffect } from 'react'

export default function MyAppointments() {
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [cancellingId, setCancellingId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  const token = localStorage.getItem('token')
  const apiUrl = import.meta.env.VITE_API_URL || ''

  const fetchAppointments = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiUrl}/api/appointments/my`, {
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

  const cancelAppointment = async (id) => {
    if (!confirm('Are you sure you want to cancel this appointment?')) return
    setCancellingId(id)
    try {
      const res = await fetch(`${apiUrl}/api/appointments/${id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      })
      const data = await res.json()

      if (res.ok) {
        setAppointments((prev) => prev.filter((a) => a.id !== id))
      } else {
        alert(`Cancel failed: ${data.error}`)
      }
    } catch {
      alert('Network error')
    } finally {
      setCancellingId(null)
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

  const statusColors = {
    BOOKED: 'status-booked',
    PENDING_HOLD: 'status-hold',
    COMPLETED: 'status-completed',
  }

  const urgencyColors = {
    High: '#f87171',
    Medium: '#fbbf24',
    Low: '#34d399',
  }

  return (
    <div className="page">
      <h1>My Appointments</h1>

      {loading ? (
        <p className="empty-state">Loading...</p>
      ) : appointments.length === 0 ? (
        <div className="empty-state">
          <p>No appointments yet.</p>
          <a href="#/doctors" className="btn btn-primary">Find a Doctor</a>
        </div>
      ) : (
        <div className="appointments-list">
          {appointments.map((apt) => (
            <div key={apt.id} className="appointment-card doctor-apt-card">
              <div className="appointment-info">
                <div className="apt-header-row">
                  <h3>{apt.doctorName}</h3>
                  <span className="badge">{apt.specialisation}</span>
                  <span className={`status-badge ${statusColors[apt.status]}`}>
                    {apt.status}
                  </span>
                </div>
                <p className="appointment-time">{formatTime(apt.slotStartTime)}</p>

                {/* Symptom Analysis */}
                {apt.symptomAnalysis && (
                  <div className="symptom-preview">
                    {apt.symptomAnalysis.urgency && (
                      <span style={{ color: urgencyColors[apt.symptomAnalysis.urgency], fontWeight: 700 }}>
                        {apt.symptomAnalysis.urgency} urgency
                      </span>
                    )}
                    {' · '}
                    <strong>Chief complaint:</strong> {apt.symptomAnalysis.chiefComplaint}
                  </div>
                )}
              </div>

              <div className="appointment-actions">
                {/* Show details toggle for completed */}
                {apt.status === 'COMPLETED' && apt.postVisitSummary && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setExpandedId(expandedId === apt.id ? null : apt.id)}
                  >
                    {expandedId === apt.id ? 'Hide Details' : 'View Summary'}
                  </button>
                )}
                {apt.status === 'BOOKED' && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => cancelAppointment(apt.id)}
                    disabled={cancellingId === apt.id}
                  >
                    {cancellingId === apt.id ? '...' : 'Cancel'}
                  </button>
                )}
              </div>

              {/* Expanded post-visit summary */}
              {expandedId === apt.id && apt.postVisitSummary && (
                <div className="post-visit-result">
                  <h4>Doctor's Summary</h4>
                  <p>{apt.postVisitSummary.patientSummary}</p>

                  {apt.postVisitSummary.medications?.length > 0 && (
                    <div>
                      <h5>💊 Medications:</h5>
                      <ul>
                        {apt.postVisitSummary.medications.map((m, i) => (
                          <li key={i}>
                            <strong>{m.drug}</strong> — {m.dosage}, {m.frequency} for {m.durationDays} days
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {apt.postVisitSummary.followUpSteps?.length > 0 && (
                    <div>
                      <h5>📋 Follow-up Steps:</h5>
                      <ul>
                        {apt.postVisitSummary.followUpSteps.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
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
