import React, { useCallback, useEffect, useRef, useState } from 'react';
import { adminApi } from '../services/auth';
import { PLATFORM_NAMES, errorOutcome, localTime } from '../services/outcomes';
import { Icon } from '../components/Icon';
import { navigate } from '../hooks/useHashRoute';

const RANGES = [7, 30, 90];
const REFRESH_MS = 60_000; // "online now" and the counts stay current while the page is open
const HEALTH_PLATFORMS = ['chatgpt', 'gemini', 'claude'];
const LINK_PLACEHOLDERS = {
  chatgpt: 'https://chatgpt.com/share/…',
  gemini: 'https://gemini.google.com/share/…',
  claude: 'https://claude.ai/share/…'
};

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'failures', label: 'Failures' },
  { id: 'health', label: 'Platform health' }
];

const GRADE_LABELS = {
  verified: 'Verified',
  verified_with_warnings: 'Verified with warnings',
  unverified: 'Unverified',
  incomplete: 'Incomplete',
  failed: 'Verification failed'
};

// What a failure usually means, written for the admin rather than the visitor
const ADMIN_HINTS = {
  NOT_FOUND: 'Usually a private, deleted or mistyped share link.',
  ACCESS_BLOCKED: 'The platform showed a human-verification check. The app never bypasses these; it usually clears up later.',
  UNRECOGNIZED_FORMAT: 'The platform may have changed its page. Run a platform health check.',
  EXTRACTION_FAILED: 'The page could not be read. If this repeats, run a platform health check.',
  TIMEOUT: 'The platform or the server was too slow. Many at once can mean the server is overloaded.',
  BUSY: 'Every browser slot was in use. Consider raising BROWSER_MAX_CONCURRENCY.',
  CANCELLED: 'The person cancelled or left the page before it finished.',
  failed: 'The extracted text did not pass the integrity check, so nothing was produced.'
};

function outcomeLabel(outcome) {
  return GRADE_LABELS[outcome] || errorOutcome(outcome)?.title || String(outcome).replace(/_/g, ' ').toLowerCase();
}

function failureHint(outcome) {
  return ADMIN_HINTS[outcome] || errorOutcome(outcome)?.hint || '';
}

function compact(n) {
  if (n == null) return '—';
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function when(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function ago(ms) {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return relative.format(-minutes, 'minute');
  if (minutes < 48 * 60) return relative.format(-Math.round(minutes / 60), 'hour');
  return relative.format(-Math.round(minutes / 1440), 'day');
}

function seconds(ms) {
  return ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Every day in the range, so days without conversions show as empty columns. */
function fillDays(byDay, days) {
  const map = Object.fromEntries(byDay.map((d) => [d.day, d]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push(map[day] || { day, conversions: 0, succeeded: 0 });
  }
  return out;
}

/** The dashboard section comes from the address (#/admin/accounts), so Back and links work. */
function readTab() {
  const sub = window.location.hash.split(/[/?]/)[2];
  return TABS.some((t) => t.id === sub) ? sub : 'overview';
}

function useAdminTab() {
  const [tab, setTab] = useState(readTab);
  useEffect(() => {
    const onChange = () => setTab(readTab());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const select = useCallback((id) => {
    window.location.hash = id === 'overview' ? '#/admin' : `#/admin/${id}`;
  }, []);
  return [tab, select];
}

/** 'ok' when every checked platform works, 'down' when one does not, null before any check. */
function healthState(health) {
  const checked = health?.platforms.filter((p) => p.configured && p.latest) || [];
  if (!checked.length) return null;
  return checked.some((p) => !p.latest.ok) ? 'down' : 'ok';
}

function StatTile({ label, value, sub, live }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{live && <span className="live-dot" aria-hidden="true" />}{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

function PlatformName({ platform }) {
  if (!platform) return <span className="cell-muted">—</span>;
  return (
    <span className="platform-name">
      <span className={`platform-dot ${platform}`} aria-hidden="true" /> {PLATFORM_NAMES[platform] || platform}
    </span>
  );
}

function ResultBadge({ ok }) {
  return (
    <span className={`status-badge ${ok ? 'is-on' : 'is-off'}`}>
      <Icon name={ok ? 'check' : 'x'} size={12} strokeWidth={3} /> {ok ? 'Success' : 'Failed'}
    </span>
  );
}

/** Single-series column chart: one colour, hairline grid, max labelled, tooltip on hover/focus. */
function DailyColumns({ data, showTable, label = 'Conversions per day' }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.conversions));
  const peak = data.reduce((best, d, i) => (d.conversions > (data[best]?.conversions ?? -1) ? i : best), 0);
  const dayLabel = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const every = Math.ceil(data.length / 8); // keep x labels from colliding

  if (showTable) {
    return (
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Day</th><th className="num">Conversions</th><th className="num">Succeeded</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.day}><td>{dayLabel(d.day)}</td><td className="num">{d.conversions}</td><td className="num">{d.succeeded}</td></tr>)}</tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="col-chart" onMouseLeave={() => setHover(null)}>
      <div className="col-grid" aria-hidden="true">
        {/* Clean ticks only: the midpoint is shown when it is a distinct whole number */}
        <span style={{ bottom: '100%' }}><em>{max}</em></span>
        {max >= 2 && max % 2 === 0 && <span style={{ bottom: '50%' }}><em>{max / 2}</em></span>}
        <span style={{ bottom: 0 }}><em>0</em></span>
      </div>
      <div className="col-plot" role="list" aria-label={label}>
        {data.map((d, i) => (
          <div
            key={d.day}
            role="listitem"
            tabIndex={0}
            className={`col-slot ${hover === i ? 'is-hover' : ''}`}
            aria-label={`${dayLabel(d.day)}: ${d.conversions} conversions, ${d.succeeded} succeeded`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          >
            <div className="col-bar" style={{ height: `${(d.conversions / max) * 100}%` }}>
              {i === peak && d.conversions > 0 && <span className="col-value">{d.conversions}</span>}
            </div>
            {hover === i && (
              <div className={`chart-tip ${i > data.length / 2 ? 'is-left' : ''}`} role="presentation">
                <strong>{dayLabel(d.day)}</strong>
                <span>{plural(d.conversions, 'conversion')}</span>
                <span>{d.succeeded} succeeded · {d.conversions - d.succeeded} failed</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="col-axis" aria-hidden="true">
        {data.map((d, i) => <span key={d.day}>{i % every === 0 || i === data.length - 1 ? dayLabel(d.day) : ''}</span>)}
      </div>
    </div>
  );
}

/** Horizontal bars, one series → one colour; identity from the platform dot beside the label. */
function PlatformBars({ rows, showTable }) {
  const max = Math.max(1, ...rows.map((r) => r.conversions));
  if (rows.length === 0) return <p className="empty-note">No conversions in this period.</p>;
  if (showTable) {
    return (
      <table className="data-table">
        <thead><tr><th>Platform</th><th className="num">Conversions</th><th className="num">Succeeded</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.platform}><td>{PLATFORM_NAMES[r.platform] || r.platform}</td><td className="num">{r.conversions}</td><td className="num">{r.succeeded}</td></tr>)}</tbody>
      </table>
    );
  }
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.platform} title={`${r.succeeded} of ${r.conversions} succeeded`}>
          <span className="hbar-label"><PlatformName platform={r.platform} /></span>
          <span className="hbar-track">
            <span className="hbar" style={{ width: `${(r.conversions / max) * 100}%` }} />
            <span className="hbar-value">{r.conversions}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Accounts with the most PDFs in the period; a name opens that account's details. */
function TopUsers({ rows, showTable, onOpenUser }) {
  if (rows.length === 0) return <p className="empty-note">No PDFs in this period.</p>;
  const max = Math.max(1, ...rows.map((r) => r.pdfs));
  if (showTable) {
    return (
      <table className="data-table">
        <thead><tr><th>Account</th><th className="num">PDFs</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td className="cell-email">{r.email}</td><td className="num">{r.pdfs}</td></tr>)}</tbody>
      </table>
    );
  }
  return (
    <ul className="hbars is-wide">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" className="link-label hbar-name" title={`${r.email} — show details`} onClick={() => onOpenUser(r.id)}>
            {r.email}
          </button>
          <span className="hbar-track">
            <span className="hbar" style={{ width: `${(r.pdfs / max) * 100}%` }} />
            <span className="hbar-value">{r.pdfs}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function OutcomesTable({ rows }) {
  if (rows.length === 0) return <p className="empty-note">No conversions in this period.</p>;
  return (
    <table className="data-table">
      <thead><tr><th>Outcome</th><th className="num">Count</th></tr></thead>
      <tbody>
        {rows.map((o) => (
          <tr key={`${o.outcome}-${o.ok}`}>
            <td><ResultBadge ok={o.ok} /> {outcomeLabel(o.outcome)}</td>
            <td className="num">{o.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OverviewTab({ stats, days, tables, onOpenUser, onExport }) {
  const t = stats.totals;
  const successRate = t.conversions ? Math.round((t.succeeded / t.conversions) * 100) : null;
  return (
    <>
      <section className="stat-grid" aria-label="Totals">
        <StatTile label="Online now" value={stats.users.onlineNow} sub="active in the last 5 minutes" live={stats.users.onlineNow > 0} />
        <StatTile label="Conversions" value={compact(t.conversions)} sub={`PDFs and previews, last ${days} days`} />
        <StatTile label="Success rate" value={successRate == null ? '—' : `${successRate}%`} sub={`${t.failed} failed`} />
        <StatTile label="Active users" value={compact(t.activeUsers)} sub={`${plural(stats.users.total, 'account')} · ${plural(stats.users.admins, 'admin')}`} />
        <StatTile label="Pages generated" value={compact(t.pages)} />
        <StatTile label="Average time" value={t.avgDurationMs ? `${(t.avgDurationMs / 1000).toFixed(1)} s` : '—'} sub="successful conversions" />
      </section>

      <section className="card chart-card">
        <div className="card-head-row">
          <h2 className="card-title small">Conversions per day</h2>
          <button type="button" className="button button-ghost button-sm" onClick={onExport}>
            <Icon name="download" size={15} /> Usage log (CSV)
          </button>
        </div>
        <DailyColumns data={fillDays(stats.byDay, days)} showTable={tables} />
      </section>

      <div className="two-col">
        <section className="card chart-card">
          <h2 className="card-title small">Top users <span className="title-note">PDFs, last {days} days</span></h2>
          <TopUsers rows={stats.topUsers} showTable={tables} onOpenUser={onOpenUser} />
        </section>
        <section className="card chart-card">
          <h2 className="card-title small">By platform</h2>
          <PlatformBars rows={stats.byPlatform} showTable={tables} />
        </section>
      </div>

      <section className="card chart-card">
        <h2 className="card-title small">Outcomes</h2>
        <OutcomesTable rows={stats.byOutcome} />
      </section>
    </>
  );
}

/** "3 / 30" — PDFs made today against the account's daily limit. */
function todayCell(u, defaultLimit) {
  if (u.role === 'admin') return { text: String(u.pdfsToday), sub: 'no limit (admin)' };
  if (u.unlimited) return { text: String(u.pdfsToday), sub: 'no limit' };
  const limit = u.dailyPdfLimit ?? defaultLimit;
  if (u.dailyPdfLimit == null && !defaultLimit) return { text: String(u.pdfsToday), sub: 'no limit' };
  return { text: `${u.pdfsToday} / ${limit}`, sub: u.dailyPdfLimit == null ? 'default limit' : 'custom limit', out: u.pdfsToday >= limit };
}

function UsersTable({ users, me, defaultLimit, onChange, onDelete, onOpenUser, busyId }) {
  return (
    <div className="table-scroll">
      <table className="data-table users-table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Role</th>
            <th>Status</th>
            <th className="num">PDFs</th>
            <th className="num">Previews</th>
            <th className="num">Failed</th>
            <th className="num">Today</th>
            <th><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const self = u.id === me.id;
            const today = todayCell(u, defaultLimit);
            return (
              <tr key={u.id} className={u.disabled ? 'is-disabled' : ''}>
                <td>
                  <span className="cell-email">{u.email}</span>
                  {self && <span className="you-chip">you</span>}
                  <span className="cell-sub">
                    {u.onlineNow ? (
                      <span className="online"><span className="online-dot" aria-hidden="true" />Online now</span>
                    ) : u.lastActiveAt ? (
                      `Active ${when(u.lastActiveAt)}`
                    ) : (
                      `Joined ${when(u.createdAt)} · not used yet`
                    )}
                  </span>
                </td>
                <td>
                  <select
                    aria-label={`Role for ${u.email}`}
                    value={u.role}
                    disabled={self || busyId === u.id}
                    onChange={(e) => onChange(u, { role: e.target.value })}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td>
                  <span className={`status-badge ${u.disabled ? 'is-off' : 'is-on'}`}>
                    <Icon name={u.disabled ? 'x' : 'check'} size={12} strokeWidth={3} /> {u.disabled ? 'Disabled' : 'Active'}
                  </span>
                </td>
                <td className="num">
                  <strong>{u.pdfs}</strong>
                  <span className="cell-sub">{u.pdfsTotal} all time</span>
                </td>
                <td className="num">{u.previews}</td>
                <td className="num">{u.failed}</td>
                <td className="num">
                  <span className={today.out ? 'is-warn' : ''}>{today.text}</span>
                  <span className="cell-sub">{today.sub}</span>
                </td>
                <td className="cell-actions">
                  <button type="button" className="button button-ghost button-sm" onClick={() => onOpenUser(u.id)} aria-label={`Details for ${u.email}`}>
                    Details
                  </button>
                  {!self && (
                    <>
                      <button type="button" className="button button-ghost button-sm" disabled={busyId === u.id} onClick={() => onChange(u, { disabled: !u.disabled })}>
                        {u.disabled ? 'Enable' : 'Disable'}
                      </button>
                      <button type="button" className="icon-button danger" disabled={busyId === u.id} onClick={() => onDelete(u)} aria-label={`Delete ${u.email}`}>
                        <Icon name="trash" size={16} />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CreateUserForm({ onCreate }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await onCreate({ email: email.trim(), password, role });
    setBusy(false);
    if (result.ok) {
      setMessage({ ok: true, text: `Created ${result.data.email}. Share the password with them securely; they can change it under Account.` });
      setEmail('');
      setPassword('');
      setRole('user');
    } else {
      setMessage({ ok: false, text: result.error.message });
    }
  };

  return (
    <form className="create-user" onSubmit={submit}>
      <label className="text-field"><span>Email</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="text-field"><span>Temporary password</span><input type="text" required minLength={10} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <label className="text-field"><span>Role</span>
        <select value={role} onChange={(e) => setRole(e.target.value)}><option value="user">User</option><option value="admin">Admin</option></select>
      </label>
      <button type="submit" className="button button-primary" disabled={busy || !email || password.length < 10}>Create account</button>
      {message && <p className={message.ok ? 'form-ok' : 'form-error'} role="status">{message.text}</p>}
    </form>
  );
}

function AccountsTab({ users, me, days, defaultLimit, busyId, onChange, onDelete, onCreate, onOpenUser, onExport }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? users.filter((u) => u.email.includes(q)) : users;
  const online = users.filter((u) => u.onlineNow).length;

  return (
    <section className="card">
      <div className="card-head-row">
        <div>
          <h2 className="card-title small"><Icon name="layers" size={17} /> Accounts</h2>
          <p className="card-subtitle">
            {plural(users.length, 'account')} · {online} online now. PDFs, previews and failed attempts are for the last {days} days;
            most active first.
          </p>
        </div>
        <div className="head-actions">
          <label className="search-field">
            <Icon name="search" size={15} />
            <span className="sr-only">Search accounts by email</span>
            <input type="search" placeholder="Search by email" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button type="button" className="button button-ghost button-sm" onClick={onExport}>
            <Icon name="download" size={15} /> Accounts (CSV)
          </button>
        </div>
      </div>

      {shown.length ? (
        <UsersTable users={shown} me={me} defaultLimit={defaultLimit} onChange={onChange} onDelete={onDelete} onOpenUser={onOpenUser} busyId={busyId} />
      ) : (
        <p className="empty-note">No account matches “{query.trim()}”.</p>
      )}
      <p className="table-note">
        <strong>Details</strong> shows an account&apos;s activity and lets you change its daily PDF limit. You cannot change your
        own role or disable yourself, and the last admin cannot be removed.
      </p>

      <h3 className="subhead">Add an account</h3>
      <CreateUserForm onCreate={onCreate} />
    </section>
  );
}

/**
 * Daily PDF limit for one account: the site default, a custom number, or
 * unlimited. The state starts from the saved values; after a save the new
 * saved values match it, so the form is clean again.
 */
function QuotaEditor({ user, quota, defaultLimit, onSave }) {
  const saved = user.unlimited ? 'unlimited' : user.dailyPdfLimit != null ? 'custom' : 'default';
  const [mode, setMode] = useState(saved);
  const [custom, setCustom] = useState(String(user.dailyPdfLimit ?? (defaultLimit || 30)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  if (user.role === 'admin') {
    return (
      <p className="card-subtitle">
        <Icon name="clock" size={15} /> Administrators have no daily PDF limit.
        {quota && ` ${plural(quota.usedToday, 'PDF')} made today.`}
      </p>
    );
  }

  const n = Number(custom);
  const validCustom = custom.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 10_000;
  const dirty = mode !== saved || (mode === 'custom' && n !== user.dailyPdfLimit);
  const changes =
    mode === 'unlimited' ? { unlimited: true } : mode === 'custom' ? { unlimited: false, dailyPdfLimit: n } : { unlimited: false, dailyPdfLimit: null };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await onSave(changes);
    setBusy(false);
    setMessage(result.ok ? { ok: true, text: 'Saved. The new limit applies from the next PDF.' } : { ok: false, text: result.error.message });
  };

  const pick = (next) => {
    setMode(next);
    setMessage(null);
  };

  return (
    <form className="quota-form" onSubmit={save}>
      <fieldset className="choice-list">
        <legend className="choice-legend">
          Daily PDF limit
          <span>
            {quota
              ? `${plural(quota.usedToday, 'PDF')} made today · resets at ${localTime(quota.resetsAt)} your time (00:00 UTC). Previews do not count.`
              : 'Previews do not count.'}
          </span>
        </legend>
        <label className={`choice ${mode === 'default' ? 'is-selected' : ''}`}>
          <input type="radio" name="quota-mode" checked={mode === 'default'} onChange={() => pick('default')} />
          <span>
            <strong>Site default</strong>
            <span className="choice-help">{defaultLimit ? `${defaultLimit} PDFs a day (DAILY_PDF_LIMIT).` : 'No limit (DAILY_PDF_LIMIT is 0).'}</span>
          </span>
        </label>
        <label className={`choice ${mode === 'custom' ? 'is-selected' : ''}`}>
          <input type="radio" name="quota-mode" checked={mode === 'custom'} onChange={() => pick('custom')} />
          <span>
            <strong>
              Custom:{' '}
              <input
                type="number"
                className="lines-input"
                min="0"
                max="10000"
                step="1"
                value={custom}
                aria-label="PDFs per day"
                onFocus={() => pick('custom')}
                onChange={(e) => setCustom(e.target.value)}
              />{' '}
              PDFs a day
            </strong>
            <span className="choice-help">0 stops new PDFs but still allows previews.</span>
          </span>
        </label>
        <label className={`choice ${mode === 'unlimited' ? 'is-selected' : ''}`}>
          <input type="radio" name="quota-mode" checked={mode === 'unlimited'} onChange={() => pick('unlimited')} />
          <span>
            <strong>Unlimited</strong>
            <span className="choice-help">No daily limit for this account.</span>
          </span>
        </label>
      </fieldset>
      <div className="quota-actions">
        <button type="submit" className="button button-primary button-sm" disabled={busy || !dirty || (mode === 'custom' && !validCustom)}>
          {busy ? 'Saving…' : 'Save limit'}
        </button>
        {mode === 'custom' && !validCustom && <p className="form-error">Enter a whole number from 0 to 10,000.</p>}
        {message && <p className={message.ok ? 'form-ok' : 'form-error'} role="status">{message.text}</p>}
      </div>
    </form>
  );
}

/** One account: totals, daily limit, activity per day and platform, and the latest attempts. */
function UserDetailDialog({ row, days, tables, defaultLimit, onSaveQuota, onClose }) {
  const dialogRef = useRef(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);

  // Open as a modal once mounted (no close() in cleanup — see DownloadDialog)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let active = true;
    adminApi.userActivity(row.id, days).then((result) => {
      if (!active) return;
      if (result.ok) {
        setError(null);
        setData(result.data);
      } else {
        setError(result.error.message);
      }
    });
    return () => {
      active = false;
    };
  }, [row.id, days, version]);

  const saveQuota = async (changes) => {
    const result = await onSaveQuota(row, changes);
    if (result.ok) setVersion((v) => v + 1);
    return result;
  };

  const user = data?.user || row;
  return (
    <dialog ref={dialogRef} className="download-dialog detail-dialog" onClose={onClose} onCancel={onClose} aria-labelledby="detail-title">
      <button type="button" className="icon-button dialog-close" onClick={onClose} aria-label="Close">
        <Icon name="x" size={18} />
      </button>

      <div className="dialog-head">
        <span className="avatar large" aria-hidden="true">{user.email[0].toUpperCase()}</span>
        <div>
          <h2 id="detail-title" className="card-title detail-email">{user.email}</h2>
          <p className="card-subtitle">
            {user.role === 'admin' ? 'Administrator' : 'User'} · {user.disabled ? 'disabled' : 'active'} · joined {when(user.createdAt)}
            {row.onlineNow ? ' · online now' : row.lastActiveAt ? ` · last active ${when(row.lastActiveAt)}` : ''}
          </p>
        </div>
      </div>

      <div className="stat-grid four">
        <StatTile label="PDFs" value={row.pdfs} sub={`last ${days} days`} />
        <StatTile label="Previews" value={row.previews} sub={`last ${days} days`} />
        <StatTile label="Failed" value={row.failed} sub={`last ${days} days`} />
        <StatTile label="PDFs all time" value={row.pdfsTotal} />
      </div>

      {error && <div className="banner detail-section" role="alert"><Icon name="alert" size={18} /> <span>{error}</span></div>}

      <section className="detail-section">
        <QuotaEditor user={user} quota={data?.quota} defaultLimit={defaultLimit} onSave={saveQuota} />
      </section>

      {data && (
        <>
          <section className="detail-section">
            <h3 className="subhead">Activity per day <span className="title-note">last {days} days</span></h3>
            <DailyColumns data={fillDays(data.byDay, days)} showTable={tables} label={`${user.email}: conversions per day`} />
          </section>

          <section className="detail-section">
            <h3 className="subhead">By platform</h3>
            <PlatformBars rows={data.byPlatform} showTable={tables} />
          </section>

          <section className="detail-section">
            <h3 className="subhead">Latest attempts <span className="title-note">up to 25</span></h3>
            {data.recent.length === 0 ? (
              <p className="empty-note">No conversions or previews yet.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table attempts-table">
                  <thead>
                    <tr>
                      <th>When</th><th>Type</th><th>Platform</th><th>Result</th>
                      <th className="num">Messages</th><th className="num">Pages</th><th className="num">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r, i) => (
                      <tr key={`${r.at}-${i}`}>
                        <td className="cell-muted">{when(r.at)}</td>
                        <td>{r.kind === 'pdf' ? 'PDF' : 'Preview'}</td>
                        <td><PlatformName platform={r.platform} /></td>
                        <td><ResultBadge ok={r.ok} /> {outcomeLabel(r.outcome)}</td>
                        <td className="num">{r.messageCount ?? '—'}</td>
                        <td className="num">{r.pageCount ?? '—'}</td>
                        <td className="num">{seconds(r.durationMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </dialog>
  );
}

function FailuresTab({ days, reloadKey, onOpenUser }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    adminApi.failures(days).then((result) => {
      if (!active) return;
      if (result.ok) {
        setError(null);
        setData(result.data);
      } else {
        setError(result.error.message);
      }
    });
    return () => {
      active = false;
    };
  }, [days, reloadKey]);

  if (error) return <div className="banner" role="alert"><Icon name="alert" size={18} /> <span>{error}</span></div>;
  if (!data) return <p className="empty-note">Loading…</p>;

  const total = data.byOutcome.reduce((sum, o) => sum + o.count, 0);
  return (
    <>
      <section className="card">
        <h2 className="card-title small"><Icon name="alert" size={17} /> What went wrong</h2>
        <p className="card-subtitle">
          {total
            ? `${plural(total, 'failed attempt')} in the last ${days} days, grouped by problem and platform.`
            : `No failed conversions or previews in the last ${days} days.`}
        </p>
        {total > 0 && (
          <div className="table-scroll section-gap">
            <table className="data-table problems-table">
              <thead><tr><th>Problem</th><th>Platform</th><th className="num">Times</th><th>Last seen</th></tr></thead>
              <tbody>
                {data.byOutcome.map((o) => (
                  <tr key={`${o.outcome}-${o.platform}`}>
                    <td>
                      <strong>{outcomeLabel(o.outcome)}</strong>
                      {failureHint(o.outcome) && <span className="cell-sub">{failureHint(o.outcome)}</span>}
                    </td>
                    <td><PlatformName platform={o.platform} /></td>
                    <td className="num">{o.count}</td>
                    <td className="cell-muted">{when(o.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.recent.length > 0 && (
        <section className="card">
          <h2 className="card-title small"><Icon name="clock" size={17} /> Latest failures</h2>
          <p className="card-subtitle">The most recent {plural(data.recent.length, 'failure')}, newest first. No links or conversation text are kept.</p>
          <div className="table-scroll section-gap">
            <table className="data-table attempts-table">
              <thead><tr><th>When</th><th>Account</th><th>Type</th><th>Platform</th><th>Problem</th><th className="num">Time</th></tr></thead>
              <tbody>
                {data.recent.map((r, i) => (
                  <tr key={`${r.at}-${i}`}>
                    <td className="cell-muted">{when(r.at)}</td>
                    <td>
                      {r.userId ? (
                        <button type="button" className="link-label" onClick={() => onOpenUser(r.userId)}>{r.email}</button>
                      ) : (
                        <span className="cell-muted">deleted account</span>
                      )}
                    </td>
                    <td>{r.kind === 'pdf' ? 'PDF' : 'Preview'}</td>
                    <td><PlatformName platform={r.platform} /></td>
                    <td>{outcomeLabel(r.outcome)}</td>
                    <td className="num">{seconds(r.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

/** Last checks as a strip of marks, oldest on the left; colour plus text label for each. */
function HealthHistory({ history }) {
  return (
    <div className="health-history">
      <span className="health-history-label">Last {plural(history.length, 'check')}</span>
      <ol aria-label={`Last ${plural(history.length, 'check')}, oldest first`}>
        {history.map((h, i) => (
          <li key={`${h.at}-${i}`} className={h.ok ? 'mark-ok' : 'mark-down'} title={`${when(h.at)} — ${h.ok ? 'working' : 'not working'}: ${h.message}`}>
            <span className="sr-only">{when(h.at)}: {h.ok ? 'working' : `not working (${outcomeLabel(h.outcome)})`}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const HEALTH_BADGES = {
  off: { text: 'No test link', badge: 'is-neutral', icon: 'link' },
  new: { text: 'Not checked yet', badge: 'is-neutral', icon: 'clock' },
  ok: { text: 'Working', badge: 'is-on', icon: 'check' },
  down: { text: 'Not working', badge: 'is-off', icon: 'x' }
};

function PlatformHealthCard({ status }) {
  const { platform, configured, latest, history } = status;
  const state = !configured ? 'off' : !latest ? 'new' : latest.ok ? 'ok' : 'down';
  const badge = HEALTH_BADGES[state];
  return (
    <article className={`health-card state-${state}`} aria-label={`${PLATFORM_NAMES[platform]}: ${badge.text}`}>
      <header className="health-card-head">
        <strong><PlatformName platform={platform} /></strong>
        <span className={`status-badge ${badge.badge}`}><Icon name={badge.icon} size={12} strokeWidth={3} /> {badge.text}</span>
      </header>
      {configured && latest ? (
        <>
          <p className="health-message">{latest.message}</p>
          {!latest.ok && failureHint(latest.outcome) && <p className="health-hint">{failureHint(latest.outcome)}</p>}
          <p className="health-meta">
            {ago(latest.at)} · {latest.runBy === 'scheduled' ? 'automatic' : 'manual'} check · took {seconds(latest.durationMs)}
          </p>
        </>
      ) : (
        <p className="health-message is-muted">{configured ? 'Saved. Run a check to test it.' : 'Add a test link below to watch this platform.'}</p>
      )}
      {configured && history.length > 0 && <HealthHistory history={history} />}
    </article>
  );
}

function HealthTab({ health, running, onRun, onSaveLinks }) {
  const [links, setLinks] = useState(health.links);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [runMessage, setRunMessage] = useState(null);

  const configured = health.platforms.filter((p) => p.configured).length;
  const dirty = HEALTH_PLATFORMS.some((p) => (links[p] || '').trim() !== (health.links[p] || ''));
  const busy = running || health.running;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    const result = await onSaveLinks(Object.fromEntries(HEALTH_PLATFORMS.map((p) => [p, (links[p] || '').trim()])));
    setSaving(false);
    if (result.ok) {
      setLinks(result.data.links);
      setSaveMessage({ ok: true, text: 'Test links saved. Run a check to try them.' });
    } else {
      setSaveMessage({ ok: false, text: result.error.message });
    }
  };

  const run = async () => {
    setRunMessage(null);
    setSaveMessage(null);
    const result = await onRun();
    if (!result.ok) {
      setRunMessage({ ok: false, text: result.error.message });
      return;
    }
    const { results } = result.data;
    const broken = results.filter((r) => !r.ok);
    setRunMessage(
      broken.length
        ? { ok: false, text: `Not working: ${broken.map((b) => PLATFORM_NAMES[b.platform]).join(', ')}. See the details below.` }
        : { ok: true, text: `All ${plural(results.length, 'checked platform')} working.` }
    );
  };

  return (
    <>
      <section className="card">
        <div className="card-head-row">
          <div>
            <h2 className="card-title small"><Icon name="shield" size={17} /> Platform health</h2>
            <p className="card-subtitle">
              A check reads each saved test conversation the same way a conversion does (no PDF is made), so you find out when
              ChatGPT, Gemini or Claude change their pages before your users do.{' '}
              {health.scheduleHours
                ? `It also runs automatically every ${plural(health.scheduleHours, 'hour')}.`
                : 'Automatic checks are off (HEALTH_CHECK_INTERVAL_HOURS=0).'}
            </p>
          </div>
          <button type="button" className="button button-primary button-sm" disabled={busy || configured === 0} onClick={run}>
            {busy ? <><span className="mini-spinner" aria-hidden="true" /> Checking…</> : <><Icon name="refresh" size={15} /> Run check now</>}
          </button>
        </div>
        {busy && (
          <p className="progress-note" role="status">
            <span className="mini-spinner" aria-hidden="true" /> Checking {plural(configured, 'platform')}, one at a time. This can take a minute.
          </p>
        )}
        {!busy && runMessage && <p className={runMessage.ok ? 'form-ok' : 'form-error'} role="status">{runMessage.text}</p>}
        {!busy && configured === 0 && <p className="empty-note">Save at least one test link below to run a check.</p>}

        <div className="health-grid">
          {health.platforms.map((p) => <PlatformHealthCard key={p.platform} status={p} />)}
        </div>
      </section>

      <section className="card">
        <h2 className="card-title small"><Icon name="link" size={17} /> Test links</h2>
        <p className="card-subtitle">
          One public share link per platform: a conversation you are happy for the server to read regularly. These are the only
          share links the app stores. Leave a field empty to skip that platform.
        </p>
        <form className="health-links" onSubmit={save}>
          {HEALTH_PLATFORMS.map((p) => (
            <label key={p} className="text-field">
              <span><PlatformName platform={p} /></span>
              <input
                type="url"
                inputMode="url"
                spellCheck={false}
                autoComplete="off"
                placeholder={LINK_PLACEHOLDERS[p]}
                value={links[p] || ''}
                onChange={(e) => {
                  setLinks((prev) => ({ ...prev, [p]: e.target.value }));
                  setSaveMessage(null);
                }}
              />
            </label>
          ))}
          <div className="health-links-actions">
            <button type="submit" className="button button-primary button-sm" disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save test links'}
            </button>
            {saveMessage && <p className={saveMessage.ok ? 'form-ok' : 'form-error'} role="status">{saveMessage.text}</p>}
          </div>
        </form>
      </section>
    </>
  );
}

/** Tabs with arrow-key navigation (WAI-ARIA tabs pattern). */
function AdminTabs({ tab, onSelect, extras }) {
  const refs = useRef({});
  const onKeyDown = (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: TABS.length - 1 - i }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = TABS[(i + step + TABS.length) % TABS.length].id;
    onSelect(next);
    refs.current[next]?.focus();
  };
  return (
    <div className="admin-tabs" role="tablist" aria-label="Dashboard sections" onKeyDown={onKeyDown}>
      {TABS.map((t) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[t.id] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={tab === t.id ? 0 : -1}
          className={`admin-tab ${tab === t.id ? 'is-active' : ''}`}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
          {extras[t.id]}
        </button>
      ))}
    </div>
  );
}

export function AdminPage({ me }) {
  const [tab, selectTab] = useAdminTab();
  const [days, setDays] = useState(7);
  const [tables, setTables] = useState(false);
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState(null);
  const [health, setHealth] = useState(null);
  const [healthRunning, setHealthRunning] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    Promise.all([adminApi.stats(days), adminApi.users(days)]).then(([s, u]) => {
      if (!active) return;
      if (!s.ok || !u.ok) {
        setLoadError((s.ok ? u : s).error.message);
        return;
      }
      setLoadError(null);
      setStats(s.data);
      setUsers(u.data);
      setUpdatedAt(Date.now());
    });
    return () => {
      active = false;
    };
  }, [days, reloadKey]);

  // Platform status (also drives the dot on the tab)
  useEffect(() => {
    let active = true;
    adminApi.health().then((result) => {
      if (active && result.ok) setHealth(result.data);
    });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  // Refresh while the page is visible
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [reload]);

  // A scheduled check started elsewhere: follow it until it finishes
  useEffect(() => {
    if (!health?.running || healthRunning) return undefined;
    const id = setInterval(() => {
      adminApi.health().then((result) => result.ok && setHealth(result.data));
    }, 5000);
    return () => clearInterval(id);
  }, [health?.running, healthRunning]);

  const change = async (user, changes) => {
    setBusyId(user.id);
    setActionError(null);
    const result = await adminApi.updateUser(user.id, changes);
    setBusyId(null);
    if (!result.ok) setActionError(result.error.message);
    reload();
    return result;
  };

  const remove = async (user) => {
    if (!window.confirm(`Delete ${user.email}? Their conversion counts stay in the statistics without their name.`)) return;
    setBusyId(user.id);
    setActionError(null);
    const result = await adminApi.deleteUser(user.id);
    setBusyId(null);
    if (!result.ok) setActionError(result.error.message);
    reload();
  };

  const create = async (input) => {
    const result = await adminApi.createUser(input);
    if (result.ok) reload();
    return result;
  };

  const exportCsv = async (kind) => {
    setActionError(null);
    const result = kind === 'usage' ? await adminApi.exportUsage(days) : await adminApi.exportAccounts(days);
    if (!result.ok) setActionError(result.error.message);
  };

  const runHealth = async () => {
    setHealthRunning(true);
    const result = await adminApi.runHealthCheck();
    setHealthRunning(false);
    if (result.ok) setHealth(result.data);
    return result;
  };

  const saveHealthLinks = async (links) => {
    const result = await adminApi.saveHealthLinks(links);
    if (result.ok) setHealth(result.data);
    return result;
  };

  const detailRow = detailId != null ? users?.find((u) => u.id === detailId) : null;
  const status = healthState(health);
  const failed = stats?.totals.failed ?? 0;
  const extras = {
    accounts: users && <span className="tab-count">{users.length}</span>,
    failures: failed > 0 && <span className="tab-count is-alert">{failed}</span>,
    health: status && (
      <span className={`tab-dot dot-${status}`}>
        <span className="sr-only">{status === 'ok' ? ' (all working)' : ' (a platform is not working)'}</span>
      </span>
    )
  };

  return (
    <div className="page admin-page">
      <header className="page-head">
        <div>
          <p className="section-eyebrow">Administration</p>
          <h1 className="page-title">Dashboard</h1>
          <p className="card-subtitle">
            Who uses the site, how many PDFs they make, and whether each platform still works. Links and conversation text are
            never stored, so none appear here.
          </p>
          <div className="page-actions">
            {/* Admins are users too: the converter is one click away */}
            <button type="button" className="button button-primary button-sm" onClick={() => navigate('home')}>
              <Icon name="file" size={15} /> Open converter
            </button>
            {updatedAt && (
              <p className="updated-note">
                Updated {localTime(updatedAt)} · refreshes every minute
                <button type="button" className="icon-button" onClick={reload} aria-label="Refresh now" title="Refresh now">
                  <Icon name="refresh" size={15} />
                </button>
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="admin-toolbar">
        <AdminTabs tab={tab} onSelect={selectTab} extras={extras} />
        {tab !== 'health' && (
          <div className="filter-row" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r} type="button" className={`segment-button ${days === r ? 'is-selected' : ''}`} aria-pressed={days === r} onClick={() => setDays(r)}>
                {r} days
              </button>
            ))}
            {tab === 'overview' && (
              <label className="table-toggle">
                <input type="checkbox" checked={tables} onChange={(e) => setTables(e.target.checked)} /> Show as tables
              </label>
            )}
          </div>
        )}
      </div>

      {(loadError || actionError) && (
        <div className="banner" role="alert"><Icon name="alert" size={18} /> <span>{actionError || loadError}</span></div>
      )}

      <div
        className={`admin-body ${busyId ? 'is-busy' : ''}`}
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        {tab === 'overview' && stats && (
          <OverviewTab stats={stats} days={days} tables={tables} onOpenUser={setDetailId} onExport={() => exportCsv('usage')} />
        )}
        {tab === 'accounts' && users && (
          <AccountsTab
            users={users}
            me={me}
            days={days}
            defaultLimit={stats?.defaultDailyLimit ?? 30}
            busyId={busyId}
            onChange={change}
            onDelete={remove}
            onCreate={create}
            onOpenUser={setDetailId}
            onExport={() => exportCsv('accounts')}
          />
        )}
        {tab === 'failures' && <FailuresTab days={days} reloadKey={reloadKey} onOpenUser={setDetailId} />}
        {tab === 'health' && (health ? (
          <HealthTab health={health} running={healthRunning} onRun={runHealth} onSaveLinks={saveHealthLinks} />
        ) : (
          <p className="empty-note">Loading…</p>
        ))}
      </div>

      {detailRow && (
        <UserDetailDialog
          key={detailRow.id}
          row={detailRow}
          days={days}
          tables={tables}
          defaultLimit={stats?.defaultDailyLimit ?? 30}
          onSaveQuota={change}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
