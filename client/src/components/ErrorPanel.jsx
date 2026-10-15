import React from 'react';
import { describeError } from '../services/outcomes';

/**
 * Explains why no PDF was produced, using the backend's error code to pick
 * the category (unsupported link, private/inaccessible, blocked, temporary
 * failure, verification failure …). Retry is always available; it is the
 * primary action when the failure is likely temporary.
 */
export function ErrorPanel({ error, onRetry, onReset }) {
  const info = describeError(error);
  const verificationErrors = error?.details?.verificationErrors || [];

  return (
    <section className={`panel error-panel tone-${info.tone}`} role="alert">
      <div className="result-header">
        <span className="result-icon" aria-hidden="true">{info.tone === 'temporary' ? '↻' : '×'}</span>
        <div>
          <h2 className="panel-title">{info.title}</h2>
          {info.message && <p className="panel-subtitle">{info.message}</p>}
        </div>
      </div>

      {info.hint && <p className="error-hint">{info.hint}</p>}

      {verificationErrors.length > 0 && (
        <ul className="detail-list is-error">
          {verificationErrors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}

      <div className="result-actions">
        <button type="button" className={`button ${info.retryable ? 'button-primary' : 'button-secondary'}`} onClick={onRetry}>
          Retry
        </button>
        <button type="button" className="button button-secondary" onClick={onReset}>
          Try another link
        </button>
      </div>
    </section>
  );
}
