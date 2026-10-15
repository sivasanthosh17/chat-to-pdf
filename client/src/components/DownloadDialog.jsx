import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

const DEFAULT_LINES = 5;

/**
 * Download options, shown when the user clicks Download:
 *   - how their own long messages appear (only when some are long)
 *   - whether to include the verification summary box on the first page
 *
 * If the choices match the PDF that already exists it downloads at once;
 * otherwise the server rebuilds the PDF with them (so they are applied and
 * labelled by the server, not faked in the browser) and it downloads when ready.
 *
 * @param {object} props
 * @param {number[]} props.lineCounts        - line count of each of the user's messages
 * @param {object}   props.current           - options the existing PDF was built with
 * @param {(options: object) => void} props.onConfirm
 * @param {() => void} props.onClose
 */
export function DownloadDialog({ lineCounts, current, onConfirm, onClose }) {
  const dialogRef = useRef(null);
  const currentLimit = current.userMessageMaxLines || null;
  const [mode, setMode] = useState(currentLimit ? 'short' : 'full');
  const [limit, setLimit] = useState(currentLimit || DEFAULT_LINES);
  const [summary, setSummary] = useState(current.includeVerificationSummary === true);

  // Open as a modal once mounted. No close() in cleanup: unmounting removes the
  // element, and closing here would fire onClose (React runs effects twice in
  // development, which would otherwise dismiss the dialog immediately).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const longCount = lineCounts.filter((c) => c > DEFAULT_LINES).length;
  const n = Math.min(Math.max(Number(limit) || 1, 1), 500);
  const affected = lineCounts.filter((c) => c > n);
  const hidden = affected.reduce((sum, c) => sum + (c - n), 0);
  const longest = lineCounts.length ? Math.max(...lineCounts) : 0;
  const showLengthChoice = longCount > 0 || currentLimit;

  const wantedLimit = mode === 'short' && affected.length ? n : null;
  const needsRebuild = wantedLimit !== currentLimit || summary !== (current.includeVerificationSummary === true);

  const confirm = (event) => {
    event.preventDefault();
    onConfirm({ userMessageMaxLines: wantedLimit, includeVerificationSummary: summary }, needsRebuild);
  };

  return (
    <dialog ref={dialogRef} className="download-dialog" onClose={onClose} onCancel={onClose} aria-labelledby="dl-title">
      <form method="dialog" onSubmit={confirm}>
        <div className="dialog-head">
          <span className="tone-icon" aria-hidden="true"><Icon name="download" size={20} /></span>
          <div>
            <h2 id="dl-title" className="card-title">Download options</h2>
            <p className="card-subtitle">Choose how your PDF should look.</p>
          </div>
        </div>

        {showLengthChoice && (
          <fieldset className="choice-list">
            <legend className="choice-legend">
              Your messages
              <span>
                {longCount} {longCount === 1 ? 'is' : 'are'} longer than {DEFAULT_LINES} lines (longest: {longest} lines)
              </span>
            </legend>
            <label className={`choice ${mode === 'full' ? 'is-selected' : ''}`}>
              <input type="radio" name="dl-mode" value="full" checked={mode === 'full'} onChange={() => setMode('full')} />
              <span>
                <strong>Full messages</strong>
                <span className="choice-help">Everything you wrote, exactly as sent.</span>
              </span>
            </label>
            <label className={`choice ${mode === 'short' ? 'is-selected' : ''}`}>
              <input type="radio" name="dl-mode" value="short" checked={mode === 'short'} onChange={() => setMode('short')} />
              <span>
                <strong>
                  Only the first{' '}
                  <input
                    type="number"
                    className="lines-input"
                    min="1"
                    max="500"
                    value={limit}
                    aria-label="Number of lines to keep"
                    onFocus={() => setMode('short')}
                    onChange={(e) => setLimit(e.target.value)}
                  />{' '}
                  lines of each message
                </strong>
                <span className="choice-help">
                  {affected.length
                    ? `${affected.length} message${affected.length === 1 ? '' : 's'} shortened, ${hidden} line${hidden === 1 ? '' : 's'} left out. Each cut is marked; AI replies stay complete.`
                    : `None of your messages is longer than ${n} lines — nothing would change.`}
                </span>
              </span>
            </label>
          </fieldset>
        )}

        <label className={`check-choice ${summary ? 'is-selected' : ''}`}>
          <input type="checkbox" checked={summary} onChange={(e) => setSummary(e.target.checked)} />
          <span>
            <strong>Include verification summary</strong>
            <span className="choice-help">
              A box on the first page saying how the text was checked and what is not included. Missing-message
              warnings and in-place notes are always shown.
            </span>
          </span>
        </label>

        <div className="actions dialog-actions">
          <button type="button" className="button button-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="button button-primary">
            <Icon name="download" size={17} /> {needsRebuild ? 'Rebuild & download' : 'Download'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
