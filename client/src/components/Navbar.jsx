import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { navigate } from '../hooks/useHashRoute';

function UserMenu({ user, route, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (target) => {
    setOpen(false);
    navigate(target);
  };

  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="user-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="avatar" aria-hidden="true">{user.email[0].toUpperCase()}</span>
        <span className="user-email">{user.email}</span>
        {user.role === 'admin' && <span className="role-chip">Admin</span>}
        <Icon name="chevronDown" size={15} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-header">
            <strong>{user.email}</strong>
            <span>{user.role === 'admin' ? 'Administrator' : 'User'}</span>
          </div>
          <button type="button" role="menuitem" className={route === 'home' ? 'is-current' : ''} onClick={() => go('home')}>
            <Icon name="file" size={16} /> Converter
          </button>
          {user.role === 'admin' && (
            <button type="button" role="menuitem" className={route === 'admin' ? 'is-current' : ''} onClick={() => go('admin')}>
              <Icon name="shield" size={16} /> Admin dashboard
            </button>
          )}
          <button type="button" role="menuitem" className={route === 'account' ? 'is-current' : ''} onClick={() => go('account')}>
            <Icon name="lock" size={16} /> Account
          </button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onLogout(); }}>
            <Icon name="external" size={16} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

export function Navbar({ serverStatus, onRecheck, user, authStatus, route, onLogout, onLogin, onSignup }) {
  const label = serverStatus === 'connected' ? 'Online' : serverStatus === 'checking' ? 'Connecting' : 'Offline';

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <a className="brand" href="#top" onClick={(e) => { e.preventDefault(); navigate('home'); }} aria-label="ChatPDF Studio — home">
          <span className="brand-mark" aria-hidden="true"><Icon name="file" size={18} strokeWidth={2.2} /></span>
          <span className="brand-name">ChatPDF<span>Studio</span></span>
        </a>

        {route === 'home' && (
          <nav className="nav-links" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#platforms">Platforms</a>
            <a href="#limits">Limitations</a>
          </nav>
        )}

        <div className="nav-right">
          <button
            type="button"
            className={`status-pill status-${serverStatus}`}
            onClick={onRecheck}
            title="Re-check the connection to the conversion server"
          >
            <span className="status-dot" aria-hidden="true" />
            <span className="status-text">Server {label.toLowerCase()}</span>
          </button>
          {user && <UserMenu user={user} route={route} onLogout={onLogout} />}
          {!user && authStatus !== 'loading' && (
            <div className="nav-auth">
              <button type="button" className="button button-ghost button-sm" onClick={onLogin}>Log in</button>
              <button type="button" className="button button-primary button-sm" onClick={onSignup}>Sign up</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
