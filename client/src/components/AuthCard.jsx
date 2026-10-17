import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

/**
 * Log in / create account, as a modal dialog. It opens when a visitor tries
 * to convert or preview (or clicks Log in / Sign up in the navbar); after a
 * successful login the action they started continues automatically.
 *
 * @param {object} props
 * @param {'login'|'signup'} props.initialMode
 * @param {string} [props.reason]      - why it opened, e.g. "to convert this conversation"
 * @param {boolean} props.signupAllowed
 * @param {(email: string, password: string) => Promise<{ ok: boolean, error?: object }>} props.onLogin
 * @param {(email: string, password: string) => Promise<{ ok: boolean, error?: object }>} props.onSignup
 * @param {() => void} props.onClose
 */
export function AuthDialog({ initialMode = 'login', reason, signupAllowed, onLogin, onSignup, onClose }) {
  const dialogRef = useRef(null);
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Open as a modal once mounted (no close() in cleanup — see DownloadDialog)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

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
    <dialog ref={dialogRef} className="download-dialog auth-dialog" onClose={onClose} onCancel={onClose} aria-labelledby="auth-title">
      <button type="button" className="icon-button dialog-close" onClick={onClose} aria-label="Close">
        <Icon name="x" size={18} />
      </button>

      <div className="auth-head">
        <span className="tone-icon" aria-hidden="true"><Icon name="lock" size={20} /></span>
        <div>
          <h2 id="auth-title" className="card-title">{isSignup ? 'Create your free account' : 'Log in'}</h2>
          <p className="card-subtitle">
            {reason ? `You need an account ${reason}.` : 'Converting and previewing need an account.'}{' '}
            Your conversations are never stored.
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
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- first field of a dialog the user just opened */}
          <input type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
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
          {busy ? 'Please wait…' : `${isSignup ? 'Create account' : 'Log in'}${reason ? ' & continue' : ''}`}
        </button>
        {!signupAllowed && <p className="muted-note">New accounts are created by an administrator.</p>}
      </form>
    </dialog>
  );
}
