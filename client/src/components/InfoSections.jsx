import React, { useEffect, useState } from 'react';
import { fetchSupportedPlatforms } from '../services/api';
import { Icon } from './Icon';

const STEPS = [
  { icon: 'shield', title: 'Check the link', text: 'Only public HTTPS share links on the official platform domains are accepted. Internal and private network addresses are refused.' },
  { icon: 'search', title: 'Retrieve', text: 'The public share page is read the way a browser reads it, with network access limited to that platform. Bot checks are never bypassed.' },
  { icon: 'check', title: 'Verify', text: 'Message order, counts and exact text are checked. ChatGPT shares carry an independent copy to compare against; Gemini and Claude do not.' },
  { icon: 'file', title: 'Render & re-check', text: 'The PDF comes from a fixed template with all text escaped. Its text layer is read back to confirm nothing was lost.' }
];

const FALLBACK_PLATFORMS = [
  { id: 'chatgpt', name: 'ChatGPT', allowedHosts: ['chatgpt.com', 'chat.openai.com'], verification: 'independent', note: 'Verified message-by-message against an independent copy in the share data.' },
  { id: 'gemini', name: 'Google Gemini', allowedHosts: ['gemini.google.com'], verification: 'unverified', note: 'Read from the rendered page; no independent source exists, so conversions are labelled unverified.' },
  { id: 'claude', name: 'Claude', allowedHosts: ['claude.ai'], verification: 'unverified', note: 'Order and completeness checked via message links; text has no second copy. Claude sometimes shows a bot check that this app will not bypass.' }
];

const LIMITATIONS = [
  'Images, file attachments, tool calls, web searches and reasoning traces are not reproduced; the PDF marks each place where such content occurred.',
  'Mathematical expressions appear as their LaTeX source, not typeset formulas.',
  'Claude sometimes shows a human-verification check to automated browsers; when that happens the conversion stops with a clear message.',
  'Platforms change their pages without notice. If a link that used to work fails with “Could not read the conversation”, the extractor needs updating.'
];

export function HowItWorks() {
  return (
    <section id="how" className="section" aria-labelledby="how-heading">
      <p className="section-eyebrow">How it works</p>
      <h2 id="how-heading" className="section-title">From link to verified PDF in four steps</h2>
      <ol className="step-grid">
        {STEPS.map((s, i) => (
          <li key={s.title} className="feature-card">
            <span className="feature-icon"><Icon name={s.icon} size={20} /></span>
            <span className="feature-num">0{i + 1}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PlatformSupport() {
  const [platforms, setPlatforms] = useState(FALLBACK_PLATFORMS);

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
    <section id="platforms" className="section" aria-labelledby="platforms-heading">
      <p className="section-eyebrow">Supported platforms</p>
      <h2 id="platforms-heading" className="section-title">Honest about what each platform allows</h2>
      <div className="platform-grid">
        {platforms.map((p) => (
          <article key={p.id} className={`platform-card platform-${p.id}`}>
            <div className="platform-card-head">
              <span className={`platform-logo ${p.id}`} aria-hidden="true">{p.name[0]}</span>
              <h3>{p.name}</h3>
              <span className={`grade-badge ${p.verification === 'independent' ? 'grade-verified' : 'grade-unverified'}`}>
                {p.verification === 'independent' ? 'Verified' : 'Unverified'}
              </span>
            </div>
            <p className="platform-hosts">{p.allowedHosts.join(' · ')}{p.id === 'gemini' ? ' · share.gemini.google · g.co/gemini/share' : ''}</p>
            {p.note && <p className="platform-note">{p.note}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}

export function Limitations() {
  return (
    <section id="limits" className="section" aria-labelledby="limits-heading">
      <details className="limits">
        <summary>
          <span>
            <span className="section-eyebrow">Good to know</span>
            <span id="limits-heading" className="limits-title">Known limitations</span>
          </span>
          <Icon name="chevronDown" size={20} className="limits-chevron" />
        </summary>
        <ul>{LIMITATIONS.map((l) => <li key={l}>{l}</li>)}</ul>
      </details>
    </section>
  );
}
