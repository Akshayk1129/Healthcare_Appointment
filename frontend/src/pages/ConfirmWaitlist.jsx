import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

export default function ConfirmWaitlist() {
  const [searchParams] = useSearchParams();
  const slotId = searchParams.get('slotId');
  const token = searchParams.get('token');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const jwt = localStorage.getItem('token');
  const apiUrl = import.meta.env.VITE_API_URL || '';

  useEffect(() => {
    if (!jwt) {
      window.location.hash = '#/login';
    }
  }, [jwt]);

  const confirmWaitlistSlot = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/appointments/${slotId}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify({ holdOwnerToken: token }),
      });
      const data = await res.json();
      
      if (res.ok) {
        setResult({ success: true });
        setTimeout(() => {
          window.location.hash = '#/my-appointments';
        }, 2000);
      } else {
        setResult({ success: false, error: data.error || 'Confirmation failed' });
      }
    } catch {
      setResult({ success: false, error: 'Network error' });
    } finally {
      setLoading(false);
    }
  };

  if (!slotId || !token) {
    return <div className="page"><p>Invalid confirmation link.</p></div>;
  }

  return (
    <div className="page" style={{ textAlign: 'center', marginTop: '100px' }}>
      <h1>Confirm Your Waitlist Slot</h1>
      <p>Your 1-hour exclusive hold is active. Claim it now!</p>
      
      {result?.success ? (
        <div className="alert alert-success" style={{ margin: '20px auto', maxWidth: '400px', backgroundColor: 'rgba(52, 211, 153, 0.1)', color: '#34d399', padding: '15px', borderRadius: '8px' }}>
          ✅ Slot confirmed! Redirecting to your appointments...
        </div>
      ) : (
        <>
          <button className="btn btn-primary" onClick={confirmWaitlistSlot} disabled={loading}>
            {loading ? 'Confirming...' : 'Confirm Appointment Now'}
          </button>
          {result && !result.success && (
            <div className="alert alert-error" style={{ margin: '20px auto', maxWidth: '400px' }}>
              {result.error}
            </div>
          )}
        </>
      )}
    </div>
  );
}
