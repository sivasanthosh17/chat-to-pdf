import React from 'react';
import { Icon } from './Icon';

export function Navbar({ serverStatus, onRecheck }) {
  const label = serverStatus === 'connected' ? 'Online' : serverStatus === 'checking' ? 'Connecting' : 'Offline';

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <a className="brand" href="#top" aria-label="ChatPDF Studio — back to top">
          <span className="brand-mark" aria-hidden="true"><Icon name="file" size={18} strokeWidth={2.2} /></span>
          <span className="brand-name">ChatPDF<span>Studio</span></span>
        </a>

        <nav className="nav-links" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#platforms">Platforms</a>
          <a href="#limits">Limitations</a>
        </nav>

        <button
          type="button"
          className={`status-pill status-${serverStatus}`}
          onClick={onRecheck}
          title="Re-check the connection to the conversion server"
        >
          <span className="status-dot" aria-hidden="true" />
          <span className="status-text">Server {label.toLowerCase()}</span>
        </button>
      </div>
    </header>
  );
}
