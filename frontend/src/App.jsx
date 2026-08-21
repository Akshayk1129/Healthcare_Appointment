import { useState, useEffect } from 'react'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import DoctorSearch from './pages/DoctorSearch.jsx'
import SlotList from './pages/SlotList.jsx'
import MyAppointments from './pages/MyAppointments.jsx'
import DoctorDashboard from './pages/DoctorDashboard.jsx'
import AdminDashboard from './pages/AdminDashboard.jsx'

function App() {
  const [user, setUser] = useState(null)
  const [route, setRoute] = useState(window.location.hash || '#/')
  const [calendarConnected, setCalendarConnected] = useState(false)

  const apiUrl = import.meta.env.VITE_API_URL || ''

  // Listen for hash changes
  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash || '#/')
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Restore user from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('user')
    if (stored) {
      try { setUser(JSON.parse(stored)) } catch { /* ignore */ }
    }
  }, [])

  // Check calendar connection status
  useEffect(() => {
    if (user) {
      const token = localStorage.getItem('token')
      fetch(`${apiUrl}/api/calendar/status`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
        .then(r => r.json())
        .then(d => setCalendarConnected(d.connected))
        .catch(() => {})
    }
  }, [user])

  const handleLogin = (userData) => {
    setUser(userData)
    if (userData.role === 'DOCTOR') {
      window.location.hash = '#/doctor-dashboard'
    } else if (userData.role === 'ADMIN') {
      window.location.hash = '#/admin-dashboard'
    } else {
      window.location.hash = '#/doctors'
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
    setCalendarConnected(false)
    window.location.hash = '#/login'
  }

  const connectCalendar = async () => {
    const token = localStorage.getItem('token')
    try {
      const res = await fetch(`${apiUrl}/api/calendar/auth`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.authUrl) {
        window.location.href = data.authUrl
      } else {
        alert('Calendar integration not configured yet.')
      }
    } catch {
      alert('Error connecting to Google Calendar')
    }
  }

  // Extract route params
  const doctorSlotMatch = route.match(/^#\/doctors\/([^/]+)\/slots$/)

  // Render the current page
  const renderPage = () => {
    if (route === '#/login' || (!user && route !== '#/register')) {
      return <Login onLogin={handleLogin} />
    }
    if (route === '#/register') {
      return <Register onLogin={handleLogin} />
    }
    if (route === '#/doctors' || route === '#/' || route === '') {
      return <DoctorSearch />
    }
    if (doctorSlotMatch) {
      return <SlotList doctorId={doctorSlotMatch[1]} />
    }
    if (route === '#/my-appointments') {
      return <MyAppointments />
    }
    if (route === '#/doctor-dashboard') {
      return <DoctorDashboard />
    }
    if (route === '#/admin-dashboard' && user?.role === 'ADMIN') {
      return <AdminDashboard />
    }
    return <DoctorSearch />
  }

  return (
    <div className="app">
      {/* Navigation */}
      <nav className="navbar">
        <a href="#/doctors" className="nav-brand">
          <span className="nav-icon">🏥</span> HealthConnect
        </a>
        <div className="nav-links">
          {user ? (
            <>
              {user.role === 'PATIENT' && (
                <>
                  <a href="#/doctors" className={`nav-link ${route === '#/doctors' ? 'active' : ''}`}>
                    Doctors
                  </a>
                  <a href="#/my-appointments" className={`nav-link ${route === '#/my-appointments' ? 'active' : ''}`}>
                    My Appointments
                  </a>
                </>
              )}
              {user.role === 'DOCTOR' && (
                <a href="#/doctor-dashboard" className={`nav-link ${route === '#/doctor-dashboard' ? 'active' : ''}`}>
                  Dashboard
                </a>
              )}
              {user.role === 'ADMIN' && (
                <a href="#/admin-dashboard" className={`nav-link ${route === '#/admin-dashboard' ? 'active' : ''}`}>
                  Admin Panel
                </a>
              )}

              {/* Calendar connection */}
              {user.role !== 'ADMIN' && (calendarConnected ? (
                <span className="calendar-status connected">📅 Calendar linked</span>
              ) : (
                <button className="btn btn-ghost btn-sm calendar-btn" onClick={connectCalendar}>
                  📅 Connect Calendar
                </button>
              )}

              <span className="nav-user">
                {user.name} <span className="badge badge-sm">{user.role}</span>
              </span>
              <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
                Logout
              </button>
            </>
          ) : (
            <>
              <a href="#/login" className="nav-link">Login</a>
              <a href="#/register" className="btn btn-primary btn-sm">Register</a>
            </>
          )}
        </div>
      </nav>

      {/* Main content */}
      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  )
}

export default App
