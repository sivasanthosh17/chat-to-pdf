import React from 'react';
import { PLATFORM_NAMES } from '../services/outcomes';

const SLOW_PLATFORMS = new Set(['gemini', 'claude']);

/**
 * Honest progress: the server runs retrieval → verification → PDF rendering
 * in one request, so we show which steps happen and how long it has taken,
 * not an invented percentage.
 */
export function ConversionProgress({ mode, platform, elapsed, onCancel }) {
  const slow = SLOW_PLATFORMS.has(platform);
  const steps = mode === 'inspect'
    ? ['Link validated', 'Retrieving the shared conversation', 'Verifying messages']
    : ['Link validated', 'Retrieving the shared conversation', 'Verifying messages', 'Rendering and checking the PDF'];

  return (
    <section className="panel progress-panel" aria-live="polite" aria-busy="true">
      <div className="progress-header">
        <span className="spinner" aria-hidden="true" />
        <div>
          <h2 className="panel-title">{mode === 'inspect' ? 'Retrieving conversation…' : 'Converting to PDF…'}</h2>
          <p className="panel-subtitle">
            {elapsed}s elapsed
            {platform && platform !== 'auto' ? ` · ${PLATFORM_NAMES[platform]}` : ''}
            {slow ? ' · pages rendered in a browser usually take 15–60 s' : ''}
          </p>
        </div>
      </div>

      <ol className="progress-steps">
        {steps.map((step, i) => (
          <li key={step} className={i === 0 ? 'is-done' : 'is-pending'}>
            <span className="step-marker" aria-hidden="true">{i === 0 ? '✓' : ''}</span>
            {step}
          </li>
        ))}
      </ol>
      <p className="progress-note">Steps after the first run on the server in a single request.</p>

      <button type="button" className="button button-secondary" onClick={onCancel}>Cancel</button>
    </section>
  );
}
