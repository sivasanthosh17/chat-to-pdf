import React, { useState } from 'react';
import { Icon } from './Icon';

/**
 * Log in / create account. Shown in place of the converter when nobody is
 * logged in.
 */
export function AuthCard({ signupAllowed, onLogin, onSignup }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isSignup = mode === 'signup' && signupAllowed;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = isSignup ? await onSignup(email.trim(), password) : await onLogin(email.trim(), password);
    setBusy(false);
    if (!result.ok) setError(result.error.message);
  };

  const switchTo = (next) => {
    setMode(next);
    setError(null);
  };

  return (
    <section className="card converter-card auth-card" aria-labelledby="auth-title">
      <div className="auth-head">
        <span className="tone-icon" aria-hidden="true"><Icon name="lock" size={20} /></span>
        <div>
          <h2 id="auth-title" className="card-title">{isSignup ? 'Create your account' : 'Log in to convert'}</h2>
          <p className="card-subtitle">
            {isSignup
              ? 'Free account. Your conversations are never stored.'
              : 'Converting conversations needs an account.'}
          </p>
        </div>
      </div>

      {signupAllowed && (
        <div className="auth-tabs" role="tablist" aria-label="Account">
          <button type="button" role="tab" aria-selected={!isSignup} className={!isSignup ? 'is-active' : ''} onClick={() => switchTo('login')}>
            Log in
          </button>
          <button type="button" role="tab" aria-selected={isSignup} className={isSignup ? 'is-active' : ''} onClick={() => switchTo('signup')}>
            Create account
          </button>
        </div>
      )}

      <form className="auth-form" onSubmit={submit} noValidate>
        <label className="text-field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
        </label>
        <label className="text-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            required
            minLength={isSignup ? 10 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          {isSignup && <small>At least 10 characters.</small>}
        </label>

        {error && <p className="form-error" role="alert"><Icon name="alert" size={15} /> {error}</p>}

        <button type="submit" className="button button-primary" disabled={busy || !email || !password || (isSignup && password.length < 10)}>
          {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Log in'}
        </button>
        {!signupAllowed && <p className="muted-note">New accounts are created by an administrator.</p>}
      </form>
    </section>
  );
}
