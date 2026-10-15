import React, { useState } from 'react';
import { authApi } from '../services/auth';
import { Icon } from '../components/Icon';

export function AccountPage({ user }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const mismatch = confirm && next !== confirm;

  const submit = async (e) => {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setMessage(null);
    const result = await authApi.changePassword(current, next);
    setBusy(false);
    if (result.ok) {
      setMessage({ ok: true, text: 'Password changed. Other devices have been signed out.' });
      setCurrent('');
      setNext('');
      setConfirm('');
    } else {
      setMessage({ ok: false, text: result.error.message });
    }
  };

  return (
    <div className="page account-page">
      <header className="page-head">
        <div>
          <p className="section-eyebrow">Account</p>
          <h1 className="page-title">{user.email}</h1>
          <p className="card-subtitle">
            Role: <strong>{user.role === 'admin' ? 'Administrator' : 'User'}</strong> · member since{' '}
            {new Date(user.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </header>

      <section className="card narrow-card">
        <h2 className="card-title small"><Icon name="lock" size={17} /> Change password</h2>
        <form className="auth-form" onSubmit={submit}>
          <label className="text-field"><span>Current password</span>
            <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
          <label className="text-field"><span>New password</span>
            <input type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
            <small>At least 10 characters.</small>
          </label>
          <label className="text-field"><span>Repeat new password</span>
            <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {mismatch && <small className="is-error">The passwords do not match.</small>}
          </label>
          {message && <p className={message.ok ? 'form-ok' : 'form-error'} role="status">{message.text}</p>}
          <button type="submit" className="button button-primary" disabled={busy || !current || next.length < 10 || next !== confirm}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </form>
      </section>

      <section className="card narrow-card">
        <h2 className="card-title small"><Icon name="shield" size={17} /> Your data</h2>
        <p className="card-subtitle">
          We keep your email, a hashed password, your login sessions, and a count of your conversions (platform, result,
          number of pages). Share links and conversation text are never stored.
        </p>
      </section>
    </div>
  );
}
