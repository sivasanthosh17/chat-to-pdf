import React from 'react';
import { describeError } from '../services/outcomes';
import { Icon } from './Icon';

const TONE_ICON = { temporary: 'refresh', neutral: 'info', error: 'alert', warning: 'clock' };

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
    <section className={`card error-card tone-${info.tone}`} role="alert">
      <div className="result-head">
        <span className="tone-icon" aria-hidden="true"><Icon name={TONE_ICON[info.tone] || 'alert'} size={20} strokeWidth={2.5} /></span>
        <div>
          <span className="grade-badge grade-error">{error?.code?.replace(/_/g, ' ').toLowerCase() || 'error'}</span>
          <h2 className="card-title">{info.title}</h2>
          {info.message && <p className="card-subtitle">{info.message}</p>}
        </div>
      </div>

      {info.hint && <p className="error-hint"><Icon name="info" size={15} /> {info.hint}</p>}

      {verificationErrors.length > 0 && (
        <ul className="detail-list is-error">{verificationErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
      )}

      <div className="actions">
        <button type="button" className={`button ${info.retryable ? 'button-primary' : 'button-ghost'}`} onClick={onRetry}>
          <Icon name="refresh" size={16} /> Retry
        </button>
        <button type="button" className="button button-ghost" onClick={onReset}>
          Try another link
        </button>
      </div>
    </section>
  );
}
