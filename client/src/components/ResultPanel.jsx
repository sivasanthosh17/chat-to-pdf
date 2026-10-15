import React, { useState } from 'react';
import { GRADE_OUTCOMES, PLATFORM_NAMES } from '../services/outcomes';

/**
 * Shown after POST /api/convert succeeds. The download button is only
 * rendered when a real PDF blob exists.
 */
export function ResultPanel({ result, onReset }) {
  const [showDetails, setShowDetails] = useState(result.grade !== 'verified');
  const outcome = GRADE_OUTCOMES[result.grade] || GRADE_OUTCOMES.unverified;

  const download = () => {
    // Create the object URL at click time and revoke it later, so the browser
    // has finished reading the blob before the URL disappears.
    const href = URL.createObjectURL(result.blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = result.filename || 'conversation.pdf';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  };

  return (
    <section className={`panel result-panel tone-${outcome.tone}`} aria-live="polite">
      <div className="result-header">
        <span className="result-icon" aria-hidden="true">
          {outcome.tone === 'success' ? '✓' : outcome.tone === 'warning' ? '!' : 'i'}
        </span>
        <div>
          <h2 className="panel-title">{outcome.title}</h2>
          <p className="panel-subtitle">{outcome.description}</p>
        </div>
      </div>

      <dl className="result-facts">
        <div><dt>Platform</dt><dd>{PLATFORM_NAMES[result.platform] || '—'}</dd></div>
        <div><dt>Messages</dt><dd>{result.messageCount}</dd></div>
        <div><dt>Pages</dt><dd>{result.pageCount || '—'}</dd></div>
        <div>
          <dt>PDF text check</dt>
          <dd className={result.regressionCheck === 'passed' ? 'is-ok' : 'is-warn'}>
            {result.regressionCheck === 'passed' ? 'All text found' : 'Needs review'}
          </dd>
        </div>
      </dl>

      {result.warnings.length > 0 || result.notes.length > 0 ? (
        <div className="result-details">
          <button type="button" className="link-button" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? 'Hide' : 'Show'} verification details
            {result.warnings.length ? ` (${result.warnings.length} warning${result.warnings.length > 1 ? 's' : ''})` : ''}
          </button>
          {showDetails && (
            <div className="details-body">
              {result.warnings.length > 0 && (
                <ul className="detail-list is-warning">
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              {result.warningsTruncated && <p className="muted">More warnings are listed on the PDF's first page.</p>}
              {result.notes.length > 0 && (
                <ul className="detail-list">
                  {result.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : null}

      <div className="result-actions">
        <button type="button" className="button button-primary" onClick={download}>
          Download PDF
        </button>
        <button type="button" className="button button-secondary" onClick={onReset}>
          Convert another
        </button>
      </div>
      <p className="muted small">{result.filename}</p>
    </section>
  );
}
