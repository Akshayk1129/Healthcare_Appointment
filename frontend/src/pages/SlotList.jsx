import { useState, useEffect } from 'react'

export default function SlotList({ doctorId }) {
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [holdingId, setHoldingId] = useState(null)
  const [holdResult, setHoldResult] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)

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
        // Remove the slot from the available list
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

  return (
    <div className="page">
      <a href="#/doctors" className="link back-link">← Back to Doctors</a>
      <h1>Available Slots</h1>

      {/* Hold confirmation banner */}
      {holdResult?.success && (
        <div className="hold-banner">
          <p>
            🔒 Slot held! Expires at{' '}
            <strong>{new Date(holdResult.holdExpiresAt).toLocaleTimeString()}</strong>
          </p>
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
              fetchSlots()
            }}
          >
            Cancel
          </button>
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
                disabled={holdingId === slot.id || holdResult?.success}
              >
                {holdingId === slot.id ? '...' : 'Book'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
