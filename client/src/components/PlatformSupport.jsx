import React, { useEffect, useState } from 'react';
import { fetchSupportedPlatforms } from '../services/api';

const FALLBACK = [
  { id: 'chatgpt', name: 'ChatGPT', allowedHosts: ['chatgpt.com', 'chat.openai.com'], verification: 'independent' },
  { id: 'gemini', name: 'Google Gemini', allowedHosts: ['gemini.google.com'], verification: 'unverified' },
  { id: 'claude', name: 'Claude', allowedHosts: ['claude.ai'], verification: 'unverified' }
];

/**
 * What each platform's extractor can honestly promise (served by /api/platforms).
 */
export function PlatformSupport() {
  const [platforms, setPlatforms] = useState(FALLBACK);

  useEffect(() => {
    let active = true;
    fetchSupportedPlatforms().then((data) => {
      if (active && data.length) setPlatforms(data);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="info-section" aria-labelledby="platforms-heading">
      <h2 id="platforms-heading" className="section-title">Supported platforms</h2>
      <div className="platform-grid">
        {platforms.map((p) => (
          <div key={p.id} className="platform-card">
            <div className="platform-card-header">
              <span className={`platform-dot ${p.id}`} aria-hidden="true" />
              <h3>{p.name}</h3>
              <span className={`badge ${p.verification === 'independent' ? 'badge-success' : 'badge-info'}`}>
                {p.verification === 'independent' ? 'Verified' : 'Unverified'}
              </span>
            </div>
            <p className="platform-hosts">{p.allowedHosts.join(', ')}{p.id === 'gemini' ? ', g.co/gemini/share' : ''}</p>
            {p.note && <p className="platform-note">{p.note}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
