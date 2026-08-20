import { useState, useEffect } from 'react'

export default function DoctorSearch() {
  const [specialisation, setSpecialisation] = useState('')
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(false)

  const searchDoctors = async () => {
    setLoading(true)
    try {
      const apiUrl = import.meta.env.VITE_API_URL || ''
      const query = specialisation ? `?specialisation=${encodeURIComponent(specialisation)}` : ''
      const res = await fetch(`${apiUrl}/api/doctors${query}`)
      const data = await res.json()
      setDoctors(data.doctors || [])
    } catch {
      setDoctors([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    searchDoctors()
  }, [])

  return (
    <div className="page">
      <h1>Find a Doctor</h1>

      <div className="search-bar">
        <input
          type="text"
          placeholder="Search by specialisation (e.g. Cardiology)"
          value={specialisation}
          onChange={(e) => setSpecialisation(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && searchDoctors()}
        />
        <button className="btn btn-primary" onClick={searchDoctors} disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      <div className="card-grid">
        {doctors.length === 0 && !loading && (
          <p className="empty-state">No doctors found. Try a different specialisation.</p>
        )}

        {doctors.map((doc) => (
          <div key={doc.id} className="card doctor-card">
            <div className="card-header">
              <span className="doctor-avatar">🩺</span>
              <div>
                <h3>{doc.name}</h3>
                <span className="badge">{doc.specialisation}</span>
              </div>
            </div>
            <div className="card-body">
              <p><strong>Slot duration:</strong> {doc.slotDurationMinutes} min</p>
              <p><strong>Email:</strong> {doc.email}</p>
            </div>
            <a href={`#/doctors/${doc.id}/slots`} className="btn btn-secondary">
              View Available Slots
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}
