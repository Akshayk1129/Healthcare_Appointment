import { useState, useEffect } from 'react'

function App() {
  const [healthStatus, setHealthStatus] = useState('checking')
  const [statusDetail, setStatusDetail] = useState('Connecting to server...')

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || ''
        const res = await fetch(`${apiUrl}/api/health`)
        if (res.ok) {
          const data = await res.json()
          setHealthStatus('online')
          setStatusDetail(`API responding · ${data.timestamp || 'connected'}`)
        } else {
          setHealthStatus('offline')
          setStatusDetail(`Server returned ${res.status}`)
        }
      } catch {
        setHealthStatus('offline')
        setStatusDetail('Could not reach API server')
      }
    }

    checkHealth()
    const interval = setInterval(checkHealth, 30000)
    return () => clearInterval(interval)
  }, [])

  const statusLabels = {
    checking: 'Checking...',
    online: 'System Online',
    offline: 'System Offline',
  }

  return (
    <div className="landing">
      <div className="landing-content">
        <div className="landing-icon">🏥</div>
        <h1 className="landing-title">HealthConnect</h1>
        <p className="landing-subtitle">
          Smart appointment booking with AI-powered visit summaries,
          real-time scheduling, and automated patient notifications.
        </p>

        <div className="status-card" id="health-status">
          <span className={`status-dot ${healthStatus}`}></span>
          <div className="status-info">
            <span className="status-label">{statusLabels[healthStatus]}</span>
            <span className="status-detail">{statusDetail}</span>
          </div>
        </div>

        <div className="features">
          <span className="feature-pill">🩺 Doctor Scheduling</span>
          <span className="feature-pill">📋 AI Summaries</span>
          <span className="feature-pill">🔒 Secure Booking</span>
          <span className="feature-pill">📧 Notifications</span>
          <span className="feature-pill">📅 Calendar Sync</span>
        </div>
      </div>
    </div>
  )
}

export default App
