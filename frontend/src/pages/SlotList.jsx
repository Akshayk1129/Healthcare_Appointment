import { useState, useEffect } from 'react'

export default function SlotList({ doctorId }) {
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [holdingId, setHoldingId] = useState(null)
  const [holdResult, setHoldResult] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)
  const [symptoms, setSymptoms] = useState('')
  const [symptomResult, setSymptomResult] = useState(null)
  const [submittingSymptoms, setSubmittingSymptoms] = useState(false)
  const [waitlistDate, setWaitlistDate] = useState('')
  const [waitlistResult, setWaitlistResult] = useState(null)

  const token = localStorage.getItem('token')
  const apiUrl = import.meta.env.VITE_API_URL || ''

  const fetchSlots = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiUrl}/api/doctors/${doctorId}/slots`)
      const data = await res.json()
      setSlots(data.slots || [])
    } catch {
      setSlots([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSlots()
  }, [doctorId])

  const holdSlot = async (slotId) => {
    if (!token) {
      window.location.hash = '#/login'
      return
    }
    setHoldingId(slotId)
    setHoldResult(null)
    setSymptomResult(null)
    setSymptoms('')
    try {
      const res = await fetch(`${apiUrl}/api/appointments/${slotId}/hold`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      })
      const data = await res.json()

      if (res.ok) {
        setHoldResult({
          success: true,
          slotId,
          holdOwnerToken: data.appointment.holdOwnerToken,
          holdExpiresAt: data.appointment.holdExpiresAt,
        })
        setSlots((prev) => prev.filter((s) => s.id !== slotId))
      } else {
        setHoldResult({ success: false, error: data.error })
      }
    } catch {
      setHoldResult({ success: false, error: 'Network error' })
    } finally {
      setHoldingId(null)
    }
  }

  const submitSymptoms = async () => {
    if (!symptoms.trim() || !holdResult?.slotId) return
    setSubmittingSymptoms(true)
    try {
      const res = await fetch(
        `${apiUrl}/api/appointments/${holdResult.slotId}/symptoms`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ symptoms }),
        }
      )
      const data = await res.json()
      if (res.ok) {
        setSymptomResult(data.analysis)
      }
    } catch {
      // Symptom submission is optional — don't block
    } finally {
      setSubmittingSymptoms(false)
    }
  }

  const confirmSlot = async () => {
    if (!holdResult?.holdOwnerToken) return
    setConfirmingId(holdResult.slotId)
    try {
      const res = await fetch(
        `${apiUrl}/api/appointments/${holdResult.slotId}/confirm`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ holdOwnerToken: holdResult.holdOwnerToken }),
        }
      )
      const data = await res.json()

      if (res.ok) {
        setHoldResult(null)
        setSymptomResult(null)
        setSymptoms('')
        alert('Appointment confirmed! ✅')
        window.location.hash = '#/my-appointments'
      } else {
        alert(`Confirmation failed: ${data.error}`)
      }
    } catch {
      alert('Network error during confirmation')
    } finally {
      setConfirmingId(null)
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
    High: '#f87171',
    Medium: '#fbbf24',
    Low: '#34d399',
  }

  const joinWaitlist = async () => {
    if (!token) {
      window.location.hash = '#/login'
      return
    }
    if (!waitlistDate) return
    try {
      const res = await fetch(`${apiUrl}/api/appointments/waitlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ doctorId, date: waitlistDate })
      })
      const data = await res.json()
      if (res.ok) {
        setWaitlistResult({ success: true, message: data.message })
      } else {
        setWaitlistResult({ success: false, message: data.error })
      }
    } catch {
      setWaitlistResult({ success: false, message: 'Network error' })
    }
  }

  return (
    <div className="page">
      <a href="#/doctors" className="link back-link">← Back to Doctors</a>
      <h1>Available Slots</h1>

      {/* Hold + Symptoms + Confirm flow */}
      {holdResult?.success && (
        <div className="hold-banner">
          <div className="hold-banner-header">
            <p>
              🔒 Slot held! Expires at{' '}
              <strong>{new Date(holdResult.holdExpiresAt).toLocaleTimeString()}</strong>
            </p>
          </div>

          {/* Symptoms form */}
          <div className="symptoms-section">
            <h3>📋 Describe your symptoms (optional but recommended)</h3>
            <textarea
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              placeholder="E.g., persistent headache for 3 days, mild fever, neck stiffness..."
              rows={3}
              className="symptoms-input"
            />
            <button
              className="btn btn-secondary btn-sm"
              onClick={submitSymptoms}
              disabled={submittingSymptoms || !symptoms.trim()}
            >
              {submittingSymptoms ? 'Analysing...' : 'Analyse Symptoms with AI'}
            </button>

            {/* AI Analysis Result */}
            {symptomResult && (
              <div className="symptom-result">
                {symptomResult.llmFailed ? (
                  <p className="symptom-fallback">⚠️ AI analysis unavailable — symptoms saved as-is</p>
                ) : (
                  <>
                    <div className="urgency-badge" style={{ color: urgencyColors[symptomResult.urgency] }}>
                      Urgency: {symptomResult.urgency}
                    </div>
                    <p><strong>Chief complaint:</strong> {symptomResult.chiefComplaint}</p>
                    {symptomResult.suggestedQuestions?.length > 0 && (
                      <div>
                        <strong>Suggested questions for your doctor:</strong>
                        <ul>
                          {symptomResult.suggestedQuestions.map((q, i) => (
                            <li key={i}>{q}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="hold-actions">
            <button
              className="btn btn-primary"
              onClick={confirmSlot}
              disabled={confirmingId}
            >
              {confirmingId ? 'Confirming...' : 'Confirm Appointment'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setHoldResult(null)
                setSymptomResult(null)
                setSymptoms('')
                fetchSlots()
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {holdResult && !holdResult.success && (
        <div className="alert alert-error">{holdResult.error}</div>
      )}

      {loading ? (
        <p className="empty-state">Loading slots...</p>
      ) : slots.length === 0 ? (
        <p className="empty-state">No available slots right now.</p>
      ) : (
        <div className="slot-grid">
          {slots.map((slot) => (
            <div key={slot.id} className="slot-card">
              <span className="slot-time">{formatTime(slot.slotStartTime)}</span>
              <span className="slot-dash">→</span>
              <span className="slot-time-end">
                {new Date(slot.slotEndTime).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => holdSlot(slot.id)}
                disabled={holdingId !== null}
              >
                {holdingId === slot.id ? 'Holding...' : 'Hold Slot'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Waitlist Section */}
      <div className="card" style={{ marginTop: '40px', backgroundColor: 'var(--surface-color)' }}>
        <h3>⏳ Can't find a slot for your preferred day?</h3>
        <p>Join the automated waitlist. If anyone cancels, we'll hold the slot for you for 1 hour and send you an exclusive confirmation link.</p>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '15px' }}>
          <input 
            type="date" 
            value={waitlistDate}
            onChange={(e) => setWaitlistDate(e.target.value)}
            style={{ padding: '10px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)' }}
          />
          <button className="btn btn-primary" onClick={joinWaitlist} disabled={!waitlistDate}>
            Join Waitlist
          </button>
        </div>
        {waitlistResult && (
          <p style={{ marginTop: '10px', color: waitlistResult.success ? 'var(--primary-color)' : 'var(--error-color)' }}>
            {waitlistResult.message}
          </p>
        )}
      </div>

    </div>
  )
}
