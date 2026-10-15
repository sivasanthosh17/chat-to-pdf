import React, { useState } from 'react';
import { GRADE_OUTCOMES, PLATFORM_NAMES } from '../services/outcomes';
import { Icon } from './Icon';

const TONE_ICON = { success: 'check', info: 'info', warning: 'alert' };

/**
 * Shown after a successful conversion: verification outcome, facts, details,
 * an in-page preview of the actual PDF, and download. The download button is
 * only rendered when a real PDF exists.
 */
export function ResultPanel({ result, durationMs, fromHistory, onReset }) {
  const [showDetails, setShowDetails] = useState(result.grade !== 'verified');
  const outcome = GRADE_OUTCOMES[result.grade] || GRADE_OUTCOMES.unverified;
  const href = result.previewUrl;
  const sizeKb = result.blob ? Math.max(1, Math.round(result.blob.size / 1024)) : null;

  return (
    <section className={`card result-card tone-${outcome.tone}`} aria-live="polite">
      <div className="result-grid">
        <div className="result-main">
          <div className="result-head">
            <span className="tone-icon" aria-hidden="true"><Icon name={TONE_ICON[outcome.tone] || 'info'} size={20} strokeWidth={2.5} /></span>
            <div>
              <span className={`grade-badge grade-${result.grade}`}>{result.grade.replace(/_/g, ' ')}</span>
              <h2 className="card-title">{outcome.title}</h2>
              <p className="card-subtitle">{outcome.description}</p>
            </div>
          </div>

          <dl className="facts">
            <div><dt>Platform</dt><dd><span className={`platform-dot ${result.platform}`} aria-hidden="true" /> {PLATFORM_NAMES[result.platform] || '—'}</dd></div>
            <div><dt>Messages</dt><dd>{result.messageCount}</dd></div>
            <div><dt>Pages</dt><dd>{result.pageCount || '—'}</dd></div>
            <div>
              <dt>PDF text check</dt>
              <dd className={result.regressionCheck === 'passed' ? 'is-ok' : 'is-warn'}>
                {result.regressionCheck === 'passed' ? 'All text found' : 'Needs review'}
              </dd>
            </div>
          </dl>

          {(result.warnings?.length > 0 || result.notes?.length > 0) && (
            <div className="details">
              <button type="button" className="details-toggle" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>
                <Icon name="chevronDown" size={16} className={showDetails ? 'is-open' : ''} />
                Verification details
                {result.warnings?.length ? <span className="count-badge">{result.warnings.length} warning{result.warnings.length > 1 ? 's' : ''}</span> : null}
              </button>
              {showDetails && (
                <div className="details-body">
                  {result.warnings?.length > 0 && (
                    <ul className="detail-list is-warning">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  )}
                  {result.notes?.length > 0 && (
                    <ul className="detail-list">{result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="actions">
            <a className="button button-primary" href={href} download={result.filename || 'conversation.pdf'}>
              <Icon name="download" size={17} /> Download PDF
            </a>
            <a className="button button-ghost" href={href} target="_blank" rel="noopener noreferrer">
              <Icon name="external" size={16} /> Open in new tab
            </a>
            <button type="button" className="button button-ghost" onClick={onReset}>
              <Icon name="refresh" size={16} /> Convert another
            </button>
          </div>
          <p className="file-meta">
            <Icon name="file" size={14} /> {result.filename}
            {sizeKb ? ` · ${sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`}` : ''}
            {durationMs ? ` · converted in ${(durationMs / 1000).toFixed(1)} s` : ''}
            {fromHistory ? ' · from recent conversions' : ''}
          </p>
        </div>

        <div className="pdf-preview">
          <iframe title={`Preview of ${result.filename}`} src={`${href}#view=FitH&toolbar=1`} />
          <a className="pdf-preview-fallback button button-ghost" href={href} target="_blank" rel="noopener noreferrer">
            <Icon name="eye" size={16} /> Open preview
          </a>
        </div>
      </div>
    </section>
  );
}
