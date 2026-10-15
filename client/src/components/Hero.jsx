import React from 'react';
import { Icon } from './Icon';

/**
 * Landing hero: headline, promise, and a decorative mock of the generated PDF
 * (purely illustrative — hidden from assistive technology).
 */
export function Hero() {
  return (
    <section className="hero">
      <div className="hero-copy">
        <span className="eyebrow-pill">
          <span className="platform-dot chatgpt" aria-hidden="true" />
          <span className="platform-dot gemini" aria-hidden="true" />
          <span className="platform-dot claude" aria-hidden="true" />
          ChatGPT · Gemini · Claude
        </span>
        <h1>
          Your AI conversations,
          <br />
          <span className="gradient-text">as PDFs — word for word.</span>
        </h1>
        <p className="hero-lead">
          Paste a public share link and get a clean, paginated PDF. Every message is copied exactly as written — never
          rewritten, summarised or translated — and every PDF says how thoroughly it was verified.
        </p>
        <ul className="trust-row">
          <li><Icon name="file" size={16} /> Verbatim text</li>
          <li><Icon name="shield" size={16} /> Verified where possible</li>
          <li><Icon name="lock" size={16} /> Nothing stored</li>
        </ul>
      </div>

      <div className="hero-art" aria-hidden="true">
        <div className="mock-glow" />
        <div className="mock-page">
          <div className="mock-head">
            <span className="mock-chip">CHATGPT</span>
            <span className="mock-title" />
            <span className="mock-sub" />
          </div>
          <div className="mock-banner"><Icon name="check" size={12} strokeWidth={3} /> Content verification: Verified</div>
          <div className="mock-msg user">
            <span className="mock-role">YOU</span>
            <span className="mock-line w80" />
            <span className="mock-line w55" />
          </div>
          <div className="mock-msg assistant">
            <span className="mock-role">CHATGPT</span>
            <span className="mock-line w95" />
            <span className="mock-line w85" />
            <span className="mock-code"><span /><span /><span /></span>
            <span className="mock-line w60" />
          </div>
          <div className="mock-foot">Page 1 of 6</div>
        </div>
        <div className="mock-float float-a"><span className="platform-dot gemini" /> Gemini</div>
        <div className="mock-float float-b"><span className="platform-dot claude" /> Claude</div>
      </div>
    </section>
  );
}
