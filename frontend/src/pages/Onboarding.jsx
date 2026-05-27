import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';

export default function Onboarding() {
  const { user, completeSetup, signOut } = useAuth();
  const [name, setName] = useState(user?.user_metadata?.full_name || '');
  const [dob, setDob] = useState('');
  const [pan, setPan] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await apiFetch('/api/auth/setup', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), dob, pan: pan.trim().toUpperCase() }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Setup failed');
        return;
      }

      completeSetup();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 420 }}>
        <h1 className="login-title">Welcome!</h1>
        <p className="login-subtitle">Let's set up your profile to get started</p>

        {error && (
          <div className="text-sm mb-4 p-2 rounded" style={{ background: 'var(--danger-bg, #fef2f2)', color: 'var(--danger, #ef4444)' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="onboarding-form">
          <div className="form-group">
            <label htmlFor="name">Name *</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your full name"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="dob">Date of Birth</label>
            <input
              id="dob"
              type="date"
              value={dob}
              onChange={e => setDob(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="pan">PAN Number</label>
            <input
              id="pan"
              type="text"
              value={pan}
              onChange={e => setPan(e.target.value)}
              placeholder="ABCDE1234F"
              maxLength={10}
              style={{ textTransform: 'uppercase' }}
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Setting up...' : 'Get Started'}
          </button>
        </form>

        <button
          onClick={signOut}
          className="w-full mt-4"
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer', padding: '0.5rem' }}
        >
          Sign out and use a different account
        </button>
      </div>
    </div>
  );
}
