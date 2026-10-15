import React, { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../services/auth';
import { PLATFORM_NAMES } from '../services/outcomes';
import { Icon } from '../components/Icon';

const RANGES = [7, 30, 90];

const OUTCOME_LABELS = {
  verified: 'Verified',
  verified_with_warnings: 'Verified with warnings',
  unverified: 'Unverified',
  incomplete: 'Incomplete',
  failed: 'Verification failed'
};

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

function StatTile({ label, value, sub }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

/** Single-series column chart: one colour, hairline grid, max labelled, tooltip on hover/focus. */
function DailyColumns({ data, showTable }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.conversions));
  const peak = data.reduce((best, d, i) => (d.conversions > (data[best]?.conversions ?? -1) ? i : best), 0);
  const label = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const every = Math.ceil(data.length / 8); // keep x labels from colliding

  if (showTable) {
    return (
      <table className="data-table">
        <thead><tr><th>Day</th><th>Conversions</th><th>Succeeded</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.day}><td>{label(d.day)}</td><td>{d.conversions}</td><td>{d.succeeded}</td></tr>)}</tbody>
      </table>
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
      <div className="col-plot" role="list" aria-label="Conversions per day">
        {data.map((d, i) => (
          <div
            key={d.day}
            role="listitem"
            tabIndex={0}
            className={`col-slot ${hover === i ? 'is-hover' : ''}`}
            aria-label={`${label(d.day)}: ${d.conversions} conversions, ${d.succeeded} succeeded`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          >
            <div className="col-bar" style={{ height: `${(d.conversions / max) * 100}%` }}>
              {i === peak && d.conversions > 0 && <span className="col-value">{d.conversions}</span>}
            </div>
            {hover === i && (
              <div className={`chart-tip ${i > data.length / 2 ? 'is-left' : ''}`} role="presentation">
                <strong>{label(d.day)}</strong>
                <span>{d.conversions} conversion{d.conversions === 1 ? '' : 's'}</span>
                <span>{d.succeeded} succeeded · {d.conversions - d.succeeded} failed</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="col-axis" aria-hidden="true">
        {data.map((d, i) => <span key={d.day}>{i % every === 0 || i === data.length - 1 ? label(d.day) : ''}</span>)}
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
        <thead><tr><th>Platform</th><th>Conversions</th><th>Succeeded</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.platform}><td>{PLATFORM_NAMES[r.platform] || r.platform}</td><td>{r.conversions}</td><td>{r.succeeded}</td></tr>)}</tbody>
      </table>
    );
  }
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.platform} title={`${r.succeeded} of ${r.conversions} succeeded`}>
          <span className="hbar-label"><span className={`platform-dot ${r.platform}`} aria-hidden="true" /> {PLATFORM_NAMES[r.platform] || r.platform}</span>
          <span className="hbar-track">
            <span className="hbar" style={{ width: `${(r.conversions / max) * 100}%` }} />
            <span className="hbar-value">{r.conversions}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function UsersTable({ users, me, onChange, onDelete, busyId }) {
  return (
    <div className="table-scroll">
      <table className="data-table users-table">
        <thead>
          <tr><th>Account</th><th>Role</th><th>Status</th><th className="num">Conversions</th><th>Last login</th><th><span className="sr-only">Actions</span></th></tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const self = u.id === me.id;
            return (
              <tr key={u.id} className={u.disabled ? 'is-disabled' : ''}>
                <td>
                  <span className="cell-email">{u.email}</span>
                  {self && <span className="you-chip">you</span>}
                  <span className="cell-sub">joined {when(u.createdAt)}</span>
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
                <td className="num">{u.conversions}</td>
                <td className="cell-muted">{when(u.lastLoginAt)}</td>
                <td className="cell-actions">
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

export function AdminPage({ me }) {
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [tables, setTables] = useState(false);

  const load = useCallback(async (range) => {
    const [s, u] = await Promise.all([adminApi.stats(range), adminApi.users()]);
    if (!s.ok || !u.ok) {
      setError((s.ok ? u : s).error.message);
      return;
    }
    setError(null);
    setStats(s.data);
    setUsers(u.data);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([adminApi.stats(days), adminApi.users()]).then(([s, u]) => {
      if (!active) return;
      if (!s.ok || !u.ok) return setError((s.ok ? u : s).error.message);
      setError(null);
      setStats(s.data);
      setUsers(u.data);
    });
    return () => {
      active = false;
    };
  }, [days]);

  const change = async (user, changes) => {
    setBusyId(user.id);
    const result = await adminApi.updateUser(user.id, changes);
    setBusyId(null);
    if (!result.ok) setError(result.error.message);
    await load(days);
  };

  const remove = async (user) => {
    if (!window.confirm(`Delete ${user.email}? Their conversion counts stay in the statistics without their name.`)) return;
    setBusyId(user.id);
    const result = await adminApi.deleteUser(user.id);
    setBusyId(null);
    if (!result.ok) setError(result.error.message);
    await load(days);
  };

  const create = async (input) => {
    const result = await adminApi.createUser(input);
    if (result.ok) await load(days);
    return result;
  };

  const t = stats?.totals;
  const successRate = t?.conversions ? Math.round((t.succeeded / t.conversions) * 100) : null;

  return (
    <div className="page admin-page">
      <header className="page-head">
        <div>
          <p className="section-eyebrow">Administration</p>
          <h1 className="page-title">Dashboard</h1>
          <p className="card-subtitle">Usage and accounts. Links and conversation text are never stored, so none appear here.</p>
        </div>
        <div className="filter-row" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r} type="button" className={`segment-button ${days === r ? 'is-selected' : ''}`} aria-pressed={days === r} onClick={() => setDays(r)}>
              {r} days
            </button>
          ))}
          <label className="table-toggle">
            <input type="checkbox" checked={tables} onChange={(e) => setTables(e.target.checked)} /> Show as tables
          </label>
        </div>
      </header>

      {error && <div className="banner" role="alert"><Icon name="alert" size={18} /> <span>{error}</span></div>}

      {stats && (
        <div className={`admin-body ${busyId ? 'is-busy' : ''}`}>
          <section className="stat-grid" aria-label="Totals">
            <StatTile label="Conversions" value={compact(t.conversions)} sub={`last ${days} days`} />
            <StatTile label="Success rate" value={successRate == null ? '—' : `${successRate}%`} sub={`${t.failed} failed`} />
            <StatTile label="Active users" value={compact(t.activeUsers)} sub={`${stats.users.total} accounts · ${stats.users.admins} admin${stats.users.admins === 1 ? '' : 's'}`} />
            <StatTile label="Pages generated" value={compact(t.pages)} />
            <StatTile label="Average time" value={t.avgDurationMs ? `${(t.avgDurationMs / 1000).toFixed(1)} s` : '—'} sub="successful conversions" />
          </section>

          <section className="card chart-card">
            <h2 className="card-title small">Conversions per day</h2>
            <DailyColumns data={fillDays(stats.byDay, days)} showTable={tables} />
          </section>

          <div className="two-col">
            <section className="card chart-card">
              <h2 className="card-title small">By platform</h2>
              <PlatformBars rows={stats.byPlatform} showTable={tables} />
            </section>
            <section className="card chart-card">
              <h2 className="card-title small">Outcomes</h2>
              {stats.byOutcome.length === 0 ? (
                <p className="empty-note">No conversions in this period.</p>
              ) : (
                <table className="data-table">
                  <thead><tr><th>Outcome</th><th className="num">Count</th></tr></thead>
                  <tbody>
                    {stats.byOutcome.map((o) => (
                      <tr key={`${o.outcome}-${o.ok}`}>
                        <td>
                          <span className={`status-badge ${o.ok ? 'is-on' : 'is-off'}`}>
                            <Icon name={o.ok ? 'check' : 'x'} size={12} strokeWidth={3} /> {o.ok ? 'Success' : 'Failed'}
                          </span>{' '}
                          {OUTCOME_LABELS[o.outcome] || o.outcome.replace(/_/g, ' ').toLowerCase()}
                        </td>
                        <td className="num">{o.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <section className="card">
            <div className="recent-head">
              <div>
                <h2 className="card-title small"><Icon name="layers" size={17} /> Accounts</h2>
                <p className="card-subtitle">You cannot change your own role or disable yourself, and the last admin cannot be removed.</p>
              </div>
            </div>
            <UsersTable users={users} me={me} onChange={change} onDelete={remove} busyId={busyId} />
            <h3 className="subhead">Add an account</h3>
            <CreateUserForm onCreate={create} />
          </section>
        </div>
      )}
    </div>
  );
}
