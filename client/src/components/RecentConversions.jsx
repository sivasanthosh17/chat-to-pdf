import React from 'react';
import { PLATFORM_NAMES, describeError } from '../services/outcomes';
import { Icon } from './Icon';

const GRADE_LABEL = {
  verified: 'Verified',
  verified_with_warnings: 'Verified · warnings',
  unverified: 'Unverified',
  incomplete: 'Incomplete'
};

function timeAgo(at, now) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

function shortUrl(url) {
  const bare = url.replace(/^https:\/\//, '');
  return bare.length > 44 ? `${bare.slice(0, 42)}…` : bare;
}

/**
 * This tab's conversions (memory only — gone when the tab closes): reopen a
 * result, download it again, or retry a failure without re-pasting.
 */
export function RecentConversions({ items, activeId, onShow, onRetry, onUseLink, onClear }) {
  if (items.length === 0) return null;
  const now = items[0].at;

  return (
    <section className="card recent-card" aria-labelledby="recent-heading">
      <div className="recent-head">
        <div>
          <h2 id="recent-heading" className="card-title small"><Icon name="layers" size={17} /> Recent conversions</h2>
          <p className="card-subtitle">Kept in this tab only — nothing is saved on the server.</p>
        </div>
        <button type="button" className="button button-ghost button-sm" onClick={onClear}>
          <Icon name="trash" size={15} /> Clear
        </button>
      </div>

      <ul className="recent-list">
        {items.map((item) => {
          const ok = item.status === 'success';
          const platform = item.result?.platform;
          return (
            <li key={item.id} className={`recent-item ${item.id === activeId ? 'is-active' : ''}`}>
              <span className={`recent-dot ${ok ? `platform-dot ${platform}` : 'is-failed'}`} aria-hidden="true">
                {!ok && <Icon name="x" size={10} strokeWidth={3} />}
              </span>
              <div className="recent-text">
                <span className="recent-title">
                  {ok ? item.result.title || item.result.filename : describeError(item.error).title}
                </span>
                <span className="recent-meta">
                  {ok ? `${PLATFORM_NAMES[platform]} · ${item.result.messageCount} messages · ` : ''}
                  <button type="button" className="link-button" onClick={() => onUseLink(item)} title="Put this link back in the input">
                    {shortUrl(item.url)}
                  </button>
                  {' · '}{timeAgo(item.at, now)}
                </span>
              </div>
              {ok && <span className={`grade-badge grade-${item.result.grade}`}>{GRADE_LABEL[item.result.grade] || item.result.grade}</span>}
              <div className="recent-actions">
                {ok ? (
                  <>
                    <button type="button" className="icon-button" onClick={() => onShow(item)} aria-label="Show result and preview">
                      <Icon name="eye" size={17} />
                    </button>
                    <a className="icon-button" href={item.result.previewUrl} download={item.result.filename} aria-label="Download PDF">
                      <Icon name="download" size={17} />
                    </a>
                  </>
                ) : (
                  <button type="button" className="icon-button" onClick={() => onRetry(item)} aria-label="Retry this link">
                    <Icon name="refresh" size={17} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
