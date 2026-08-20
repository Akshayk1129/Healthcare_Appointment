import { useState, useEffect } from 'react'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import DoctorSearch from './pages/DoctorSearch.jsx'
import SlotList from './pages/SlotList.jsx'
import MyAppointments from './pages/MyAppointments.jsx'

function App() {
  const [user, setUser] = useState(null)
  const [route, setRoute] = useState(window.location.hash || '#/')

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

  const handleLogin = (userData) => {
    setUser(userData)
    window.location.hash = '#/doctors'
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
    window.location.hash = '#/login'
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
              <a href="#/doctors" className={`nav-link ${route === '#/doctors' ? 'active' : ''}`}>
                Doctors
              </a>
              <a href="#/my-appointments" className={`nav-link ${route === '#/my-appointments' ? 'active' : ''}`}>
                My Appointments
              </a>
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
