import React, { useState } from 'react';
import { useUrlValidation } from '../hooks/useUrlValidation';
import { PLATFORM_NAMES } from '../services/outcomes';
import { Icon } from './Icon';

const PLATFORM_OPTIONS = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'claude', label: 'Claude' }
];

const LINK_FORMATS = [
  { platform: 'chatgpt', pattern: 'chatgpt.com/share/…' },
  { platform: 'gemini', pattern: 'gemini.google.com/share/…' },
  { platform: 'gemini', pattern: 'share.gemini.google/…' },
  { platform: 'gemini', pattern: 'g.co/gemini/share/…' },
  { platform: 'claude', pattern: 'claude.ai/share/…' }
];

/**
 * Accidental double pastes ("https://a…https://a…") keep only the first URL.
 */
function sanitizeUrl(raw) {
  const trimmed = raw.trim();
  const second = trimmed.indexOf('https://', 8);
  return second !== -1 ? trimmed.substring(0, second).trim() : trimmed;
}

const canReadClipboard = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText);

/**
 * Link input with live platform detection, a Paste button, a platform
 * selector and the primary actions. Controlled by the parent so history
 * entries can refill it.
 */
export function ConverterForm({ url, onUrlChange, platform, onPlatformChange, busy, onSubmit }) {
  const [pasteError, setPasteError] = useState(null);
  const validation = useUrlValidation(url);

  const detected = validation.status === 'valid' ? validation.data.platform : null;
  const mismatch = detected && platform !== 'auto' && platform !== detected;
  const canSubmit = validation.status === 'valid' && !mismatch && !busy;

  const submit = (mode) => (event) => {
    event?.preventDefault();
    if (canSubmit) onSubmit({ url: url.trim(), platform, mode });
  };

  const paste = async () => {
    setPasteError(null);
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) onUrlChange(sanitizeUrl(text));
      else setPasteError('The clipboard is empty.');
    } catch {
      setPasteError('Clipboard access was blocked — click the field and press Ctrl+V (⌘V on Mac).');
    }
  };

  let hint;
  if (pasteError) {
    hint = <span className="field-hint is-error">{pasteError}</span>;
  } else if (validation.status === 'checking') {
    hint = <span className="field-hint"><span className="mini-spinner" aria-hidden="true" /> Checking link…</span>;
  } else if (validation.status === 'invalid') {
    hint = <span className="field-hint is-error" role="alert"><Icon name="alert" size={15} /> {validation.error.message}</span>;
  } else if (mismatch) {
    hint = (
      <span className="field-hint is-error" role="alert">
        <Icon name="alert" size={15} /> This is a {PLATFORM_NAMES[detected]} link, but {PLATFORM_NAMES[platform]} is selected.
      </span>
    );
  } else if (detected) {
    hint = (
      <span className="field-hint is-ok">
        <Icon name="check" size={15} strokeWidth={2.5} /> {PLATFORM_NAMES[detected]} share link detected
      </span>
    );
  } else {
    hint = <span className="field-hint">Paste a public share link — private chats can't be converted.</span>;
  }

  const fieldState = validation.status === 'invalid' || mismatch ? 'has-error' : detected ? `has-success platform-${detected}` : '';

  return (
    <form className="converter-form" onSubmit={submit('pdf')} noValidate>
      <label htmlFor="share-url" className="sr-only">Shared conversation link</label>
      <div className={`url-field ${fieldState}`}>
        <Icon name="link" size={20} className="url-field-icon" />
        <input
          id="share-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck="false"
          placeholder="Paste a ChatGPT, Gemini or Claude share link"
          value={url}
          disabled={busy}
          onChange={(e) => {
            setPasteError(null);
            onUrlChange(sanitizeUrl(e.target.value));
          }}
          aria-describedby="share-url-hint"
          aria-invalid={validation.status === 'invalid' || Boolean(mismatch)}
        />
        {url && !busy && (
          <button type="button" className="icon-button" onClick={() => onUrlChange('')} aria-label="Clear link">
            <Icon name="x" size={18} />
          </button>
        )}
        {canReadClipboard && !busy && (
          <button type="button" className="paste-button" onClick={paste}>
            <Icon name="clipboard" size={16} /> Paste
          </button>
        )}
      </div>

      <div id="share-url-hint" className="field-hint-row" aria-live="polite">{hint}</div>

      <div className="format-row" aria-label="Accepted link formats">
        {LINK_FORMATS.map((f) => (
          <span key={f.pattern} className={`format-chip ${detected === f.platform ? 'is-active' : ''}`}>
            <span className={`platform-dot ${f.platform}`} aria-hidden="true" />
            {f.pattern}
          </span>
        ))}
      </div>

      <div className="form-bottom">
        <fieldset className="segmented" disabled={busy}>
          <legend className="sr-only">Platform</legend>
          {PLATFORM_OPTIONS.map((o) => (
            <label key={o.value} className={`segment ${platform === o.value ? 'is-selected' : ''}`}>
              <input
                type="radio"
                name="platform"
                value={o.value}
                checked={platform === o.value}
                onChange={() => onPlatformChange(o.value)}
              />
              {o.value !== 'auto' && <span className={`platform-dot ${o.value}`} aria-hidden="true" />}
              {o.label}
            </label>
          ))}
        </fieldset>

        <div className="form-actions">
          <button type="button" className="button button-ghost" disabled={!canSubmit} onClick={submit('inspect')}>
            <Icon name="eye" size={17} /> Preview
          </button>
          <button type="submit" className="button button-primary" disabled={!canSubmit}>
            Convert to PDF <Icon name="arrowRight" size={17} />
          </button>
        </div>
      </div>
    </form>
  );
}
