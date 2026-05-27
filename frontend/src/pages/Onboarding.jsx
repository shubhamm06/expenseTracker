import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';

const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to ExpenseTracker',
    subtitle: 'Let\'s set you up in 3 quick steps',
    icon: '👋',
  },
  {
    id: 'profile',
    title: 'Your Profile',
    subtitle: 'We use this to auto-generate passwords for your encrypted bank statements',
    icon: '👤',
  },
  {
    id: 'cards',
    title: 'Add Your Cards',
    subtitle: 'Card details help decrypt PDF statements from banks. Add all your credit cards.',
    icon: '💳',
  },
  {
    id: 'email',
    title: 'Connect Your Email',
    subtitle: 'We\'ll automatically fetch credit card statements from your inbox and import transactions.',
    icon: '📧',
  },
  {
    id: 'tour',
    title: 'You\'re All Set!',
    subtitle: 'Here\'s a quick overview of what each section does',
    icon: '🎉',
  },
];

const TAB_DESCRIPTIONS = [
  { name: 'Dashboard', icon: '📊', desc: 'Your monthly spending overview with charts, top merchants, and source breakdown.' },
  { name: 'Transactions', icon: '📋', desc: 'View, categorize, and manage all your credit card transactions in one place.' },
  { name: 'Gift Cards', icon: '🎁', desc: 'Track Amazon Pay and other gift card balances, usage, and refunds.' },
  { name: 'Upload', icon: '📤', desc: 'Manually upload bank statements (PDF/CSV) when auto-sync misses something.' },
  { name: 'Rules', icon: '⚡', desc: 'Auto-categorize transactions with pattern matching rules. Set once, works forever.' },
  { name: 'Settings', icon: '⚙️', desc: 'Manage cards, email connections, sync schedule, and your profile.' },
];

export default function Onboarding() {
  const { user, completeSetup, signOut } = useAuth();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(user?.user_metadata?.full_name || '');
  const [dob, setDob] = useState('');
  const [pan, setPan] = useState('');
  const [cards, setCards] = useState([{ bank: '', number: '' }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);

  const currentStep = STEPS[step];
  const progress = ((step + 1) / STEPS.length) * 100;

  async function saveProfile() {
    if (!name.trim()) { setError('Name is required'); return false; }
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
        return false;
      }
      setProfileSaved(true);
      return true;
    } catch {
      setError('Network error. Please try again.');
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function saveCards() {
    setLoading(true);
    setError('');
    const validCards = cards.filter(c => c.bank.trim() && c.number.replace(/\s/g, '').length === 16);
    for (const card of validCards) {
      await apiFetch('/api/settings/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bank: card.bank.trim(), card_number: card.number.replace(/\s/g, '') }),
      });
    }
    setLoading(false);
    return true;
  }

  async function handleNext() {
    if (currentStep.id === 'profile') {
      const ok = await saveProfile();
      if (!ok) return;
    }
    if (currentStep.id === 'cards') {
      const validCards = cards.filter(c => c.bank.trim() && c.number.replace(/\s/g, '').length === 16);
      if (validCards.length > 0) await saveCards();
    }
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      setError('');
    } else {
      completeSetup();
    }
  }

  function addCard() {
    setCards([...cards, { bank: '', number: '' }]);
  }

  function updateCard(idx, field, value) {
    const updated = [...cards];
    updated[idx][field] = value;
    setCards(updated);
  }

  function removeCard(idx) {
    if (cards.length === 1) return;
    setCards(cards.filter((_, i) => i !== idx));
  }

  return (
    <div className="onboarding-scene">
      <div className="onboarding-container">
        {/* Progress bar */}
        <div className="onboarding-progress">
          <div className="onboarding-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        {/* Step indicators */}
        <div className="onboarding-steps-indicator">
          {STEPS.map((s, i) => (
            <div key={s.id} className={`step-dot ${i <= step ? 'active' : ''} ${i === step ? 'current' : ''}`} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.3 }}
            className="onboarding-step-content"
          >
            {/* Header */}
            <div className="onboarding-step-header">
              <span className="onboarding-step-icon">{currentStep.icon}</span>
              <h2 className="onboarding-step-title">{currentStep.title}</h2>
              <p className="onboarding-step-subtitle">{currentStep.subtitle}</p>
            </div>

            {/* Welcome */}
            {currentStep.id === 'welcome' && (
              <div className="onboarding-welcome">
                <div className="welcome-features">
                  <div className="welcome-feature">
                    <span className="welcome-feature-icon">🔄</span>
                    <div>
                      <strong>Auto-sync statements</strong>
                      <p>Fetches credit card PDFs from your email automatically</p>
                    </div>
                  </div>
                  <div className="welcome-feature">
                    <span className="welcome-feature-icon">🏷️</span>
                    <div>
                      <strong>Smart categorization</strong>
                      <p>Rules auto-tag your transactions by merchant patterns</p>
                    </div>
                  </div>
                  <div className="welcome-feature">
                    <span className="welcome-feature-icon">📈</span>
                    <div>
                      <strong>Monthly insights</strong>
                      <p>Track spending trends, top merchants, and source breakdown</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Profile form */}
            {currentStep.id === 'profile' && (
              <div className="onboarding-form-section">
                {error && <div className="onboarding-error">{error}</div>}
                <div className="form-group">
                  <label htmlFor="name">Full Name *</label>
                  <input id="name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" autoFocus />
                </div>
                <div className="form-group">
                  <label htmlFor="dob">Date of Birth</label>
                  <input id="dob" type="date" value={dob} onChange={e => setDob(e.target.value)} />
                </div>
                <div className="form-group">
                  <label htmlFor="pan">PAN Number</label>
                  <input id="pan" type="text" value={pan} onChange={e => setPan(e.target.value)} placeholder="ABCDE1234F" maxLength={10} style={{ textTransform: 'uppercase' }} />
                </div>
                <p className="onboarding-hint">DOB + PAN + card number are combined to generate PDF passwords used by banks.</p>
              </div>
            )}

            {/* Cards */}
            {currentStep.id === 'cards' && (
              <div className="onboarding-form-section">
                {cards.map((card, idx) => (
                  <div key={idx} className="onboarding-card-row">
                    <input
                      type="text"
                      placeholder="Bank name (e.g., HDFC)"
                      value={card.bank}
                      onChange={e => updateCard(idx, 'bank', e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="16-digit card number"
                      value={card.number}
                      onChange={e => updateCard(idx, 'number', e.target.value)}
                      maxLength={19}
                    />
                    {cards.length > 1 && (
                      <button className="onboarding-remove-btn" onClick={() => removeCard(idx)} type="button">×</button>
                    )}
                  </div>
                ))}
                <button className="onboarding-add-btn" onClick={addCard} type="button">
                  + Add another card
                </button>
                <p className="onboarding-hint">You can always add more cards later in Settings.</p>
              </div>
            )}

            {/* Email */}
            {currentStep.id === 'email' && (
              <div className="onboarding-form-section">
                <div className="onboarding-email-info">
                  <div className="email-info-card">
                    <span className="email-info-icon">🔐</span>
                    <div>
                      <strong>Secure OAuth Connection</strong>
                      <p>We use Google OAuth — your password is never stored. Only email reading permission is used.</p>
                    </div>
                  </div>
                  <div className="email-info-card">
                    <span className="email-info-icon">📄</span>
                    <div>
                      <strong>What we look for</strong>
                      <p>Only credit card statement PDFs from bank emails. Everything else is ignored.</p>
                    </div>
                  </div>
                </div>
                <p className="onboarding-hint">You can connect your email from Settings after finishing this tour. Skip for now if you prefer.</p>
              </div>
            )}

            {/* Tour / Done */}
            {currentStep.id === 'tour' && (
              <div className="onboarding-tour-grid">
                {TAB_DESCRIPTIONS.map(tab => (
                  <div key={tab.name} className="tour-tab-card">
                    <span className="tour-tab-icon">{tab.icon}</span>
                    <div>
                      <strong>{tab.name}</strong>
                      <p>{tab.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Footer */}
        <div className="onboarding-footer">
          {step > 0 && (
            <button className="onboarding-back-btn" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <div style={{ flex: 1 }} />
          {currentStep.id === 'cards' && (
            <button className="onboarding-skip-btn" onClick={() => setStep(step + 1)}>
              Skip for now
            </button>
          )}
          {currentStep.id === 'email' && (
            <button className="onboarding-skip-btn" onClick={() => setStep(step + 1)}>
              I'll do this later
            </button>
          )}
          <button
            className="onboarding-next-btn"
            onClick={handleNext}
            disabled={loading}
          >
            {loading ? 'Saving...' : step === STEPS.length - 1 ? 'Enter App' : 'Continue'}
            {!loading && step < STEPS.length - 1 && <span className="btn-arrow">→</span>}
          </button>
        </div>

        {step === 0 && (
          <button onClick={signOut} className="onboarding-signout">
            Sign out and use a different account
          </button>
        )}
      </div>
    </div>
  );
}
