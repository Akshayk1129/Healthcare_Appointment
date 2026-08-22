import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

function AdminDashboard() {
  const apiUrl = import.meta.env.VITE_API_URL || '';
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [activeTab, setActiveTab] = useState('manage');
  const [analytics, setAnalytics] = useState(null);

  // Form states
  const [newDoctor, setNewDoctor] = useState({
    name: '',
    email: '',
    password: '',
    specialisation: '',
    slotDurationMinutes: 30,
    workingHours: {
      mon: { start: "09:00", end: "17:00" },
      tue: { start: "09:00", end: "17:00" },
      wed: { start: "09:00", end: "17:00" },
      thu: { start: "09:00", end: "17:00" },
      fri: { start: "09:00", end: "17:00" },
      sat: { start: "09:00", end: "13:00" },
    }
  });

  const [leaveData, setLeaveData] = useState({
    doctorId: '',
    date: '',
    reason: ''
  });

  const token = localStorage.getItem('token');

  useEffect(() => {
    fetchDoctors();
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/admin/analytics`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setAnalytics(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchDoctors = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/admin/doctors`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setDoctors(data.doctors);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const showMessage = (msg, isError = false) => {
    setMessage({ text: msg, isError });
    setTimeout(() => setMessage(null), 5000);
  };

  const handleCreateDoctor = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${apiUrl}/api/admin/doctors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newDoctor)
      });
      const data = await res.json();
      if (res.ok) {
        showMessage('Doctor created successfully');
        fetchDoctors();
        // Reset basic fields
        setNewDoctor(prev => ({...prev, name: '', email: '', password: '', specialisation: ''}));
      } else {
        showMessage(data.error || 'Failed to create doctor', true);
      }
    } catch (err) {
      showMessage('Network error', true);
    }
  };

  const handleGenerateSlots = async (doctorId) => {
    try {
      const res = await fetch(`${apiUrl}/api/admin/doctors/${doctorId}/generate-slots`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ days: 7 })
      });
      const data = await res.json();
      if (res.ok) {
        showMessage(data.message || 'Slots generated');
      } else {
        showMessage(data.error || 'Failed to generate slots', true);
      }
    } catch (err) {
      showMessage('Network error', true);
    }
  };

  const handleMarkLeave = async (e) => {
    e.preventDefault();
    if (!leaveData.doctorId || !leaveData.date) {
      showMessage('Please select a doctor and date', true);
      return;
    }
    try {
      const res = await fetch(`${apiUrl}/api/admin/doctors/${leaveData.doctorId}/leave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ date: leaveData.date, reason: leaveData.reason })
      });
      const data = await res.json();
      if (res.ok) {
        showMessage(`Leave marked successfully. Cancelled: ${data.cancelledCount}, Released: ${data.releasedCount}`);
        setLeaveData({ doctorId: '', date: '', reason: '' });
      } else {
        showMessage(data.error || 'Failed to mark leave', true);
      }
    } catch (err) {
      showMessage('Network error', true);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="admin-dashboard">
      <h2>Admin Dashboard</h2>
      
      {message && (
        <div className={`message-banner ${message.isError ? 'error' : 'success'}`}>
          {message.text}
        </div>
      )}

      <div className="tab-switcher" style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <button className={activeTab === 'manage' ? 'btn-primary' : 'btn-secondary'} onClick={() => setActiveTab('manage')}>Manage Doctors</button>
        <button className={activeTab === 'analytics' ? 'btn-primary' : 'btn-secondary'} onClick={() => setActiveTab('analytics')}>Platform Analytics</button>
      </div>

      {activeTab === 'manage' && (
      <div className="admin-grid">
        {/* Create Doctor Form */}
        <div className="card">
          <h3>Create New Doctor</h3>
          <form onSubmit={handleCreateDoctor} className="form-group" autoComplete="off">
            <input 
              type="text" 
              placeholder="Full Name" 
              value={newDoctor.name} 
              onChange={e => setNewDoctor({...newDoctor, name: e.target.value})}
              required 
              autoComplete="off"
            />
            <input 
              type="email" 
              placeholder="Email" 
              value={newDoctor.email} 
              onChange={e => setNewDoctor({...newDoctor, email: e.target.value})}
              required 
              autoComplete="off"
            />
            <input 
              type="password" 
              placeholder="Password (min 6 chars)" 
              value={newDoctor.password} 
              onChange={e => setNewDoctor({...newDoctor, password: e.target.value})}
              required 
              minLength={6}
              autoComplete="new-password"
            />
            <input 
              type="text" 
              placeholder="Specialisation (e.g. Cardiology)" 
              value={newDoctor.specialisation} 
              onChange={e => setNewDoctor({...newDoctor, specialisation: e.target.value})}
              required 
              autoComplete="off"
            />
            <button type="submit" className="btn-primary">Create Doctor</button>
          </form>
        </div>

        {/* Leave Management */}
        <div className="card">
          <h3>Mark Doctor on Leave</h3>
          <form onSubmit={handleMarkLeave} className="form-group">
            <select 
              value={leaveData.doctorId} 
              onChange={e => setLeaveData({...leaveData, doctorId: e.target.value})}
              required
            >
              <option value="">Select Doctor</option>
              {doctors.map(doc => (
                <option key={doc.id} value={doc.id}>{doc.user.name}</option>
              ))}
            </select>
            <input 
              type="date" 
              value={leaveData.date} 
              onChange={e => setLeaveData({...leaveData, date: e.target.value})}
              required 
            />
            <input 
              type="text" 
              placeholder="Reason (Optional)" 
              value={leaveData.reason} 
              onChange={e => setLeaveData({...leaveData, reason: e.target.value})}
            />
            <button type="submit" className="btn-danger">Confirm Leave & Cancel Appointments</button>
          </form>
        </div>
      </div>

      {/* Doctors List */}
      <div className="card full-width mt-20">
        <h3>Manage Doctors & Slots</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Specialisation</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {doctors.map(doc => (
              <tr key={doc.id}>
                <td>{doc.user.name}</td>
                <td>{doc.user.email}</td>
                <td>{doc.specialisation}</td>
                <td>
                  <button onClick={() => handleGenerateSlots(doc.id)} className="btn-secondary btn-sm">
                    Generate Slots (Next 7 Days)
                  </button>
                </td>
              </tr>
            ))}
            {doctors.length === 0 && (
              <tr><td colSpan="4">No doctors found</td></tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {activeTab === 'analytics' && analytics && (
        <div className="analytics-dashboard">
          <div className="analytics-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3 style={{ margin: '0 0 10px 0', color: 'var(--text-secondary)' }}>Total Doctors</h3>
              <p style={{ fontSize: '32px', fontWeight: 'bold', margin: 0, color: 'var(--primary-color)' }}>{analytics.totalDoctors}</p>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3 style={{ margin: '0 0 10px 0', color: 'var(--text-secondary)' }}>Total Patients</h3>
              <p style={{ fontSize: '32px', fontWeight: 'bold', margin: 0, color: 'var(--primary-color)' }}>{analytics.totalPatients}</p>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3 style={{ margin: '0 0 10px 0', color: 'var(--text-secondary)' }}>Total Appointments</h3>
              <p style={{ fontSize: '32px', fontWeight: 'bold', margin: 0, color: 'var(--primary-color)' }}>{analytics.totalAppointments}</p>
            </div>
          </div>

          <div className="admin-grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
            <div className="card">
              <h3>7-Day Booking Trend</h3>
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <AreaChart data={analytics.bookingTrends}>
                    <defs>
                      <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--primary-color)" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="var(--primary-color)" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="date" stroke="var(--text-secondary)" />
                    <YAxis stroke="var(--text-secondary)" />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--surface-color)', border: '1px solid rgba(255,255,255,0.1)' }} />
                    <Area type="monotone" dataKey="count" stroke="var(--primary-color)" fillOpacity={1} fill="url(#colorCount)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <h3>AI Triage Distribution</h3>
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'High', value: analytics.triageDistribution.High || 0 },
                        { name: 'Medium', value: analytics.triageDistribution.Medium || 0 },
                        { name: 'Low', value: analytics.triageDistribution.Low || 0 },
                      ]}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      <Cell fill="#ef4444" />
                      <Cell fill="#f59e0b" />
                      <Cell fill="#3b82f6" />
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: 'var(--surface-color)', border: '1px solid rgba(255,255,255,0.1)' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginTop: '10px' }}>
                <span style={{ color: '#ef4444', fontWeight: 'bold' }}>High</span>
                <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>Med</span>
                <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>Low</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
