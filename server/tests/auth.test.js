/**
 * Accounts, sessions and role-based access.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db/database.js';
import { bootstrapAdmin, createUser } from '../src/services/users.service.js';
import { hashPassword, verifyPassword } from '../src/services/password.service.js';
import { makeConversation, withServer } from './helpers.js';

const PASSWORD = 'correct horse battery';
const URL = 'https://chatgpt.com/share/abc-123';

const stubPdf = async (conversation, report) => ({
  buffer: Buffer.from('%PDF-1.4\n'),
  regressionCheck: { passed: true, checkedCount: 1, failureCount: 0, failures: [] },
  report,
  pageCount: 2
});

function setup(extra = {}) {
  const db = openDatabase(':memory:');
  const app = createApp({
    db,
    validatorOptions: { skipDns: true },
    renderPdf: stubPdf,
    extractors: { chatgpt: async () => makeConversation() },
    ...extra
  });
  return { db, app };
}

/** Small client that keeps the session cookie like a browser would. */
function client(base) {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const set = res.headers.getSetCookie().find((c) => c.startsWith('chatpdf_sid='));
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    let json = null;
    if ((res.headers.get('content-type') || '').includes('json')) json = await res.json();
    return { status: res.status, json, setCookie: set, headers: res.headers };
  };
  return {
    get: (p, h) => call('GET', p, null, h),
    post: (p, b, h) => call('POST', p, b ?? {}, h),
    patch: (p, b) => call('PATCH', p, b),
    del: (p) => call('DELETE', p),
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; }
  };
}

test('passwords are stored as salted scrypt hashes', async () => {
  const a = await hashPassword(PASSWORD);
  const b = await hashPassword(PASSWORD);
  assert.match(a, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(a, b, 'random salt');
  assert.ok(!a.includes(PASSWORD));
  assert.equal(await verifyPassword(PASSWORD, a), true);
  assert.equal(await verifyPassword('wrong password!', a), false);
});

test('sign-up creates a "user", sets a secure session cookie, and /me reports it', async () => {
  const { app, db } = setup();
  await withServer(app, async (base) => {
    const c = client(base);
    const res = await c.post('/api/auth/signup', { email: 'Ana@Example.com', password: PASSWORD });
    assert.equal(res.status, 201);
    assert.equal(res.json.data.user.email, 'ana@example.com');
    assert.equal(res.json.data.user.role, 'user');
    assert.match(res.setCookie, /HttpOnly/);
    assert.match(res.setCookie, /SameSite=Lax/);
    assert.ok(!('password_hash' in res.json.data.user));

    const me = await c.get('/api/auth/me');
    assert.equal(me.json.data.user.email, 'ana@example.com');

    // Only a hash of the session token is stored
    const token = c.cookie.split('=')[1];
    const row = db.prepare('SELECT token_hash FROM sessions').get();
    assert.notEqual(row.token_hash, token);
  });
});

test('sign-up validation: duplicate email 409, weak password 400, closed sign-up 403', async () => {
  const { app } = setup();
  await withServer(app, async (base) => {
    const c = client(base);
    await c.post('/api/auth/signup', { email: 'a@example.com', password: PASSWORD });
    assert.equal((await client(base).post('/api/auth/signup', { email: 'A@example.com', password: PASSWORD })).status, 409);
    const weak = await client(base).post('/api/auth/signup', { email: 'b@example.com', password: 'short' });
    assert.equal(weak.status, 400);
    assert.match(weak.json.error.message, /at least 10 characters/);

    process.env.ALLOW_SIGNUP = 'false';
    try {
      const closed = await client(base).post('/api/auth/signup', { email: 'c@example.com', password: PASSWORD });
      assert.equal(closed.status, 403);
      assert.equal((await client(base).get('/api/auth/me')).json.data.signupAllowed, false);
    } finally {
      delete process.env.ALLOW_SIGNUP;
    }
  });
});

test('login: same answer for unknown email and wrong password; logout ends the session', async () => {
  const { app, db } = setup();
  await createUser(db, { email: 'u@example.com', password: PASSWORD });
  await withServer(app, async (base) => {
    const unknown = await client(base).post('/api/auth/login', { email: 'nobody@example.com', password: PASSWORD });
    const wrong = await client(base).post('/api/auth/login', { email: 'u@example.com', password: 'wrong password!' });
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(unknown.json.error.message, wrong.json.error.message);

    const c = client(base);
    assert.equal((await c.post('/api/auth/login', { email: 'u@example.com', password: PASSWORD })).status, 200);
    const oldCookie = c.cookie;
    await c.post('/api/auth/logout');
    const replay = client(base);
    replay.cookie = oldCookie;
    assert.equal((await replay.get('/api/auth/me')).json.data.user, null, 'old cookie no longer works');
  });
});

test('converting requires login; users can convert', async () => {
  const { app, db } = setup();
  await createUser(db, { email: 'u@example.com', password: PASSWORD });
  await withServer(app, async (base) => {
    const anon = client(base);
    for (const path of ['/api/convert', '/api/convert/stream', '/api/extract', '/api/validate-url']) {
      const res = await anon.post(path, { url: URL });
      assert.equal(res.status, 401, path);
      assert.equal(res.json.error.code, 'UNAUTHENTICATED');
    }
    // Public endpoints stay public
    assert.equal((await anon.get('/api/health')).status, 200);
    assert.equal((await anon.get('/api/platforms')).status, 200);

    const user = client(base);
    await user.post('/api/auth/login', { email: 'u@example.com', password: PASSWORD });
    const res = await fetch(`${base}/api/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
      body: JSON.stringify({ url: URL })
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
  });
});

test('roles: users get 403 on admin routes, anonymous visitors 401', async () => {
  const { app, db } = setup();
  await createUser(db, { email: 'u@example.com', password: PASSWORD });
  await withServer(app, async (base) => {
    assert.equal((await client(base).get('/api/admin/users')).status, 401);
    const user = client(base);
    await user.post('/api/auth/login', { email: 'u@example.com', password: PASSWORD });
    for (const [method, path] of [['get', '/api/admin/users'], ['get', '/api/admin/stats'], ['post', '/api/admin/users'], ['patch', '/api/admin/users/1'], ['del', '/api/admin/users/1']]) {
      const res = await user[method](path, method === 'patch' ? { role: 'admin' } : undefined);
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.equal(res.json.error.code, 'FORBIDDEN');
    }
  });
});

test('admin: bootstrap, list, create, promote, disable (logs the user out), delete', async () => {
  const { app, db } = setup();
  assert.match(await bootstrapAdmin(db, {}), /No admin account exists yet/);
  assert.match(await bootstrapAdmin(db, { ADMIN_EMAIL: 'boss@example.com', ADMIN_PASSWORD: PASSWORD }), /created/);
  assert.equal(await bootstrapAdmin(db, { ADMIN_EMAIL: 'x@example.com', ADMIN_PASSWORD: PASSWORD }), null, 'only when no admin exists');

  await withServer(app, async (base) => {
    const admin = client(base);
    assert.equal((await admin.post('/api/auth/login', { email: 'boss@example.com', password: PASSWORD })).json.data.user.role, 'admin');

    const created = await admin.post('/api/admin/users', { email: 'new@example.com', password: PASSWORD });
    assert.equal(created.status, 201);
    const id = created.json.data.id;

    const victim = client(base);
    await victim.post('/api/auth/login', { email: 'new@example.com', password: PASSWORD });
    assert.equal((await victim.get('/api/auth/me')).json.data.user.email, 'new@example.com');

    const list = await admin.get('/api/admin/users');
    assert.deepEqual(list.json.data.map((u) => u.email).sort(), ['boss@example.com', 'new@example.com']);
    assert.ok(list.json.data.every((u) => !('password_hash' in u)));

    assert.equal((await admin.patch(`/api/admin/users/${id}`, { role: 'admin' })).json.data.role, 'admin');
    assert.equal((await admin.patch(`/api/admin/users/${id}`, { role: 'user' })).json.data.role, 'user');

    assert.equal((await admin.patch(`/api/admin/users/${id}`, { disabled: true })).json.data.disabled, true);
    assert.equal((await victim.get('/api/auth/me')).json.data.user, null, 'disabled user is logged out at once');
    const blocked = await client(base).post('/api/auth/login', { email: 'new@example.com', password: PASSWORD });
    assert.equal(blocked.status, 403);
    assert.match(blocked.json.error.message, /disabled/);

    assert.equal((await admin.del(`/api/admin/users/${id}`)).status, 200);
    assert.equal((await admin.get('/api/admin/users')).json.data.length, 1);
    assert.equal((await admin.del('/api/admin/users/9999')).status, 404);
  });
});

test('admin guards: no self-demotion, self-disable or self-delete; the last admin stays', async () => {
  const { app, db } = setup();
  const boss = await createUser(db, { email: 'boss@example.com', password: PASSWORD, role: 'admin' });
  const other = await createUser(db, { email: 'other@example.com', password: PASSWORD, role: 'admin' });
  await withServer(app, async (base) => {
    const admin = client(base);
    await admin.post('/api/auth/login', { email: 'boss@example.com', password: PASSWORD });
    for (const change of [{ role: 'user' }, { disabled: true }]) {
      const res = await admin.patch(`/api/admin/users/${boss.id}`, change);
      assert.equal(res.status, 403, JSON.stringify(change));
    }
    assert.equal((await admin.del(`/api/admin/users/${boss.id}`)).status, 403);

    // Demoting the other admin works while boss remains an admin…
    assert.equal((await admin.patch(`/api/admin/users/${other.id}`, { role: 'user' })).status, 200);
    // …and boss is now the last admin, still protected
    assert.equal((await admin.patch(`/api/admin/users/${boss.id}`, { role: 'user' })).status, 403);
    assert.equal((await admin.patch(`/api/admin/users/${other.id}`, { bogus: 1 })).status, 400);
  });
});

test('changing the password signs out other devices but keeps this one', async () => {
  const { app, db } = setup();
  await createUser(db, { email: 'u@example.com', password: PASSWORD });
  await withServer(app, async (base) => {
    const laptop = client(base);
    const phone = client(base);
    await laptop.post('/api/auth/login', { email: 'u@example.com', password: PASSWORD });
    await phone.post('/api/auth/login', { email: 'u@example.com', password: PASSWORD });

    const wrong = await laptop.post('/api/auth/password', { currentPassword: 'nope nope nope', newPassword: 'a brand new passphrase' });
    assert.equal(wrong.status, 400);

    assert.equal((await laptop.post('/api/auth/password', { currentPassword: PASSWORD, newPassword: 'a brand new passphrase' })).status, 200);
    assert.ok((await laptop.get('/api/auth/me')).json.data.user);
    assert.equal((await phone.get('/api/auth/me')).json.data.user, null);
    assert.equal((await client(base).post('/api/auth/login', { email: 'u@example.com', password: 'a brand new passphrase' })).status, 200);
  });
});

test('requests from other websites are blocked (CSRF)', async () => {
  const { app, db } = setup();
  await createUser(db, { email: 'u@example.com', password: PASSWORD });
  await withServer(app, async (base) => {
    const c = client(base);
    await c.post('/api/auth/login', { email: 'u@example.com', password: PASSWORD });
    const evil = await c.post('/api/auth/logout', {}, { Origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
    const ok = await c.post('/api/convert', { url: URL }, { Origin: 'http://localhost:5173' });
    assert.notEqual(ok.status, 403);
  });
});

test('login attempts are rate limited per IP', async () => {
  const { app } = setup({ rateLimits: { login: 3 } });
  await withServer(app, async (base) => {
    for (let i = 0; i < 3; i++) await client(base).post('/api/auth/login', { email: 'x@example.com', password: 'wrong password' });
    const res = await client(base).post('/api/auth/login', { email: 'x@example.com', password: 'wrong password' });
    assert.equal(res.status, 429);
  });
});

test('conversion limits count per account; admins are exempt; usage is logged without links', async () => {
  const { app, db } = setup({ rateLimits: { conversion: 1 } });
  await createUser(db, { email: 'u@example.com', password: PASSWORD });
  await createUser(db, { email: 'boss@example.com', password: PASSWORD, role: 'admin' });
  await withServer(app, async (base) => {
    const user = client(base);
    const admin = client(base);
    await user.post('/api/auth/login', { email: 'u@example.com', password: PASSWORD });
    await admin.post('/api/auth/login', { email: 'boss@example.com', password: PASSWORD });

    const convert = (c) => fetch(`${base}/api/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: c.cookie },
      body: JSON.stringify({ url: URL })
    }).then((r) => r.status);

    assert.equal(await convert(user), 200);
    assert.equal(await convert(user), 429);
    assert.equal(await convert(admin), 200);
    assert.equal(await convert(admin), 200);

    const stats = (await admin.get('/api/admin/stats?days=7')).json.data;
    assert.equal(stats.totals.conversions, 3, 'rate-limited request never reached the converter');
    assert.equal(stats.totals.succeeded, 3);
    assert.equal(stats.users.total, 2);
    assert.deepEqual(stats.byPlatform.map((p) => p.platform), ['chatgpt']);

    const list = (await admin.get('/api/admin/users')).json.data;
    assert.equal(list.find((u) => u.email === 'u@example.com').conversions, 1);

    // The usage table has no column that could hold a link or text
    const columns = db.prepare('PRAGMA table_info(usage)').all().map((c) => c.name);
    assert.deepEqual(columns.sort(), ['created_at', 'duration_ms', 'id', 'kind', 'message_count', 'ok', 'outcome', 'page_count', 'platform', 'user_id']);
  });
});
