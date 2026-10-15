import React, { useState } from 'react';
import { GRADE_OUTCOMES, PLATFORM_NAMES } from '../services/outcomes';
import { Icon } from './Icon';
import { DownloadDialog } from './DownloadDialog';
import { downloadResult } from '../services/download';
import { saveDownloadPrefs } from '../services/preferences';

const TONE_ICON = { success: 'check', info: 'info', warning: 'alert' };
const LONG_MESSAGE_LINES = 5;

/**
 * Shown after a successful conversion: verification outcome, facts, details,
 * an in-page preview of the actual PDF, and download. The download button is
 * only rendered when a real PDF exists.
 */
export function ResultPanel({ result, durationMs, fromHistory, onReset, onRebuild }) {
  const [showDetails, setShowDetails] = useState(result.grade !== 'verified');
  const [dialogOpen, setDialogOpen] = useState(false);
  const outcome = GRADE_OUTCOMES[result.grade] || GRADE_OUTCOMES.unverified;
  const href = result.previewUrl;
  const sizeKb = result.blob ? Math.max(1, Math.round(result.blob.size / 1024)) : null;

  const lineCounts = result.userMessageLineCounts || [];
  const applied = result.appliedOptions || {};
  const shortenedTo = applied.userMessageMaxLines || null;
  const hasLongMessages = lineCounts.some((c) => c > LONG_MESSAGE_LINES);

  // Download always goes through the options dialog
  const onDownloadClick = () => setDialogOpen(true);

  const onConfirm = (options, needsRebuild) => {
    setDialogOpen(false);
    saveDownloadPrefs(options);
    if (needsRebuild) onRebuild(options);
    else downloadResult(result);
  };

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

          {(shortenedTo || applied.includeVerificationSummary || hasLongMessages) && (
            <div className="option-note">
              <Icon name="file" size={15} />
              <span>
                {[
                  shortenedTo && `Your messages are cut after ${shortenedTo} line${shortenedTo === 1 ? '' : 's'} (marked where cut).`,
                  applied.includeVerificationSummary && 'Includes the verification summary.',
                  !shortenedTo && !applied.includeVerificationSummary && 'Some of your messages are long — you can include only their first lines.'
                ].filter(Boolean).join(' ')}
              </span>
              <button type="button" className="link-button" onClick={() => setDialogOpen(true)}>
                Change
              </button>
            </div>
          )}

          <div className="actions">
            <button type="button" className="button button-primary" onClick={onDownloadClick}>
              <Icon name="download" size={17} /> Download PDF
            </button>
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

      {dialogOpen && (
        <DownloadDialog
          lineCounts={lineCounts}
          current={applied}
          onClose={() => setDialogOpen(false)}
          onConfirm={onConfirm}
        />
      )}
    </section>
  );
}
