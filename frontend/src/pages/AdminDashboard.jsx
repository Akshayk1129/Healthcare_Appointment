import { useState, useEffect } from 'react';

function AdminDashboard() {
  const apiUrl = import.meta.env.VITE_API_URL || '';
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

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
  }, []);

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
    </div>
  );
}

export default AdminDashboard;
