import React from 'react';

export function Navbar({ serverStatus, onRecheck }) {
  const label = serverStatus === 'connected' ? 'Server online' : serverStatus === 'checking' ? 'Connecting…' : 'Server offline';

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <a className="brand" href="/" aria-label="ChatPDF Studio home">
          <span className="brand-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </span>
          <span className="brand-title">ChatPDF Studio</span>
        </a>

        <button
          type="button"
          className={`status-pill status-${serverStatus}`}
          onClick={onRecheck}
          title="Re-check the connection to the conversion server"
        >
          <span className="status-dot" aria-hidden="true" />
          {label}
        </button>
      </div>
    </header>
  );
}
