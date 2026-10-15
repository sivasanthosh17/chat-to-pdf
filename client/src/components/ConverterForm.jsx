import React, { useState } from 'react';
import { useUrlValidation } from '../hooks/useUrlValidation';
import { PLATFORM_NAMES } from '../services/outcomes';

const PLATFORM_OPTIONS = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'claude', label: 'Claude' }
];

/**
 * Accidental double pastes ("https://a…https://a…") keep only the first URL.
 */
function sanitizeUrl(raw) {
  const trimmed = raw.trim();
  const second = trimmed.indexOf('https://', 8);
  return second !== -1 ? trimmed.substring(0, second).trim() : trimmed;
}

/**
 * URL input with live platform detection, optional platform selector and the
 * primary Convert action.
 *
 * @param {{ busy: boolean, onSubmit: (req: { url: string, platform: string, mode: 'pdf'|'inspect' }) => void }} props
 */
export function ConverterForm({ busy, onSubmit }) {
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState('auto');
  const validation = useUrlValidation(url);

  const detected = validation.status === 'valid' ? validation.data.platform : null;
  const mismatch = detected && platform !== 'auto' && platform !== detected;
  const canSubmit = validation.status === 'valid' && !mismatch && !busy;

  const submit = (mode) => (event) => {
    event?.preventDefault();
    if (canSubmit) onSubmit({ url: url.trim(), platform, mode });
  };

  let hint = null;
  if (validation.status === 'checking') {
    hint = <span className="field-hint">Checking link…</span>;
  } else if (validation.status === 'invalid') {
    hint = <span className="field-hint is-error" role="alert">{validation.error.message}</span>;
  } else if (mismatch) {
    hint = (
      <span className="field-hint is-error" role="alert">
        This is a {PLATFORM_NAMES[detected]} link, but {PLATFORM_NAMES[platform]} is selected.
      </span>
    );
  } else if (detected) {
    hint = (
      <span className="field-hint is-ok">
        <span className={`platform-dot ${detected}`} aria-hidden="true" />
        {PLATFORM_NAMES[detected]} share link detected
      </span>
    );
  }

  return (
    <form className="converter-form" onSubmit={submit('pdf')} noValidate>
      <div className="field">
        <label htmlFor="share-url" className="field-label">Shared conversation link</label>
        <div className={`url-field ${validation.status === 'invalid' || mismatch ? 'has-error' : detected ? 'has-success' : ''}`}>
          <input
            id="share-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck="false"
            placeholder="https://chatgpt.com/share/…"
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(sanitizeUrl(e.target.value))}
            aria-describedby="share-url-hint"
            aria-invalid={validation.status === 'invalid' || Boolean(mismatch)}
          />
          {url && !busy && (
            <button type="button" className="icon-button" onClick={() => setUrl('')} aria-label="Clear link">
              ×
            </button>
          )}
        </div>
        <div id="share-url-hint" className="field-hint-row" aria-live="polite">
          {hint || <span className="field-hint">ChatGPT, Google Gemini (incl. g.co/gemini/share) and Claude public share links.</span>}
        </div>
      </div>

      <div className="form-row">
        <div className="field field-platform">
          <label htmlFor="platform" className="field-label">Platform</label>
          <select id="platform" value={platform} onChange={(e) => setPlatform(e.target.value)} disabled={busy}>
            {PLATFORM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={!canSubmit}>
            Convert to PDF
          </button>
          <button type="button" className="button button-secondary" disabled={!canSubmit} onClick={submit('inspect')}>
            Preview messages
          </button>
        </div>
      </div>
    </form>
  );
}
