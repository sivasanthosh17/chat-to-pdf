/**
 * Admin features: user activity, quotas, failures, CSV export, platform health.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db/database.js';
import { createUser } from '../src/services/users.service.js';
import { AppError } from '../src/utils/errors.js';
import { toCsv } from '../src/utils/csv.js';
import { makeConversation, withServer } from './helpers.js';

const PASSWORD = 'correct horse battery';
const CHATGPT = 'https://chatgpt.com/share/abc-123';
const GEMINI = 'https://gemini.google.com/share/def456';

const stubPdf = async (conversation, report) => ({
  buffer: Buffer.from('%PDF-1.4\n'),
  regressionCheck: { passed: true, checkedCount: 1, failureCount: 0, failures: [] },
  report,
  pageCount: 3
});

async function setup(extractors = {}) {
  const db = openDatabase(':memory:');
  const app = createApp({
    db,
    validatorOptions: { skipDns: true },
    renderPdf: stubPdf,
    extractors: {
      chatgpt: async () => makeConversation(),
      gemini: async () => { throw new AppError('NOT_FOUND', 'Gemini says the link does not exist.'); },
      ...extractors
    }
  });
  const admin = await createUser(db, { email: 'boss@example.com', password: PASSWORD, role: 'admin' });
  const user = await createUser(db, { email: 'u@example.com', password: PASSWORD });
  return { db, app, admin, user };
}

async function login(base, email) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD })
  });
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('chatpdf_sid=')).split(';')[0];
  const call = (method, path, body) =>
    fetch(`${base}${path}`, {
      method,
      headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    put: (p, b) => call('PUT', p, b),
    patch: (p, b) => call('PATCH', p, b),
    json: async (method, p, b) => (await call(method, p, b)).json()
  };
}

test('daily PDF quota: default, custom, unlimited; previews do not count; admins are exempt', async () => {
  process.env.DAILY_PDF_LIMIT = '2';
  try {
    const { app, user } = await setup();
    await withServer(app, async (base) => {
      const u = await login(base, 'u@example.com');
      const admin = await login(base, 'boss@example.com');

      let me = (await u.json('GET', '/api/auth/me')).data.quota;
      assert.deepEqual([me.limit, me.usedToday, me.remaining, me.source], [2, 0, 2, 'default']);

      // The login reply carries the allowance too, so the converter can show it at once
      const loggedIn = await (await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'u@example.com', password: PASSWORD })
      })).json();
      assert.deepEqual([loggedIn.data.quota.limit, loggedIn.data.quota.remaining], [2, 2]);

      assert.equal((await u.post('/api/convert', { url: CHATGPT })).status, 200);
      assert.equal((await u.post('/api/extract', { url: CHATGPT })).status, 200, 'previews are not counted');
      assert.equal((await u.post('/api/convert', { url: CHATGPT })).status, 200);
      const blocked = await u.post('/api/convert/stream', { url: CHATGPT });
      assert.equal(blocked.status, 429);
      const body = await blocked.json();
      assert.equal(body.error.code, 'QUOTA_EXCEEDED');
      assert.match(body.error.message, /today's 2 PDFs/);
      assert.equal((await u.post('/api/extract', { url: CHATGPT })).status, 200, 'previews still work');

      me = (await u.json('GET', '/api/auth/me')).data.quota;
      assert.deepEqual([me.usedToday, me.remaining], [2, 0]);

      // Admin raises this user's limit, then makes them unlimited
      await admin.patch(`/api/admin/users/${user.id}`, { dailyPdfLimit: 5 });
      me = (await u.json('GET', '/api/auth/me')).data.quota;
      assert.deepEqual([me.limit, me.remaining, me.source], [5, 3, 'custom']);
      await admin.patch(`/api/admin/users/${user.id}`, { unlimited: true });
      me = (await u.json('GET', '/api/auth/me')).data.quota;
      assert.deepEqual([me.unlimited, me.source], [true, 'unlimited']);
      await admin.patch(`/api/admin/users/${user.id}`, { unlimited: false, dailyPdfLimit: null });
      assert.equal((await u.json('GET', '/api/auth/me')).data.quota.source, 'default');

      for (let i = 0; i < 3; i++) assert.equal((await admin.post('/api/convert', { url: CHATGPT })).status, 200, 'admins have no quota');
      assert.equal((await admin.json('GET', '/api/auth/me')).data.quota.source, 'admin');

      assert.equal((await admin.patch(`/api/admin/users/${user.id}`, { dailyPdfLimit: 2.5 })).status, 400);
      assert.equal((await admin.patch(`/api/admin/users/${user.id}`, { dailyPdfLimit: -1 })).status, 400);
    });
  } finally {
    delete process.env.DAILY_PDF_LIMIT;
  }
});

test('users activity: PDFs, previews, failures, all-time totals and online now', async () => {
  const { app, user } = await setup();
  await withServer(app, async (base) => {
    const u = await login(base, 'u@example.com');
    const admin = await login(base, 'boss@example.com');
    await u.post('/api/convert', { url: CHATGPT });
    await u.post('/api/convert', { url: CHATGPT });
    await u.post('/api/extract', { url: CHATGPT });
    await u.post('/api/convert', { url: GEMINI }); // fails (NOT_FOUND)

    const list = (await admin.json('GET', '/api/admin/users?days=7')).data;
    const row = list.find((x) => x.email === 'u@example.com');
    assert.deepEqual([row.pdfs, row.previews, row.failed, row.pdfsTotal, row.pdfsToday], [2, 1, 1, 2, 2]);
    assert.equal(row.onlineNow, true);
    assert.ok(row.lastActiveAt);
    assert.equal(list[0].email, 'u@example.com', 'most active first');

    const stats = (await admin.json('GET', '/api/admin/stats?days=7')).data;
    assert.equal(stats.users.onlineNow, 2);
    assert.deepEqual(stats.topUsers.map((t) => [t.email, t.pdfs]), [['u@example.com', 2]]);

    const detail = (await admin.json('GET', `/api/admin/users/${user.id}/activity?days=30`)).data;
    assert.equal(detail.user.email, 'u@example.com');
    assert.deepEqual(detail.byPlatform.map((p) => p.platform).sort(), ['chatgpt', 'gemini']);
    assert.equal(detail.recent.length, 4);
    assert.ok(detail.recent.every((r) => !('url' in r)), 'no links in activity');
    assert.equal((await admin.get('/api/admin/users/9999/activity')).status, 404);
  });
});

test('recent failures list the error, platform and account', async () => {
  const { app } = await setup();
  await withServer(app, async (base) => {
    const u = await login(base, 'u@example.com');
    const admin = await login(base, 'boss@example.com');
    await u.post('/api/convert', { url: GEMINI });
    await u.post('/api/convert', { url: GEMINI });
    const data = (await admin.json('GET', '/api/admin/failures?days=7')).data;
    assert.deepEqual(data.byOutcome.map((o) => [o.outcome, o.platform, o.count]), [['NOT_FOUND', 'gemini', 2]]);
    assert.equal(data.recent.length, 2);
    assert.equal(data.recent[0].email, 'u@example.com');
    assert.ok(Number.isInteger(data.recent[0].userId), 'the account can be opened from the list');
  });
});

test('CSV exports: correct headers and no spreadsheet formula injection', async () => {
  const csv = toCsv([{ header: 'a', value: (r) => r.a }, { header: 'b', value: (r) => r.b }], [
    { a: '=HYPERLINK("x")', b: 'plain' },
    { a: 'has,comma', b: '+1' }
  ]);
  assert.equal(csv, '﻿a,b\r\n"\'=HYPERLINK(""x"")",plain\r\n"has,comma",\'+1\r\n');

  const { app } = await setup();
  await withServer(app, async (base) => {
    const u = await login(base, 'u@example.com');
    const admin = await login(base, 'boss@example.com');
    await u.post('/api/convert', { url: CHATGPT });

    const usage = await admin.get('/api/admin/export/usage.csv?days=30');
    assert.match(usage.headers.get('content-type'), /text\/csv/);
    assert.match(usage.headers.get('content-disposition'), /attachment; filename="chatpdf-usage-last-30-days\.csv"/);
    const text = await usage.text();
    assert.match(text, /time \(UTC\),account,type,platform,succeeded,result,messages,pages,seconds/);
    assert.match(text, /u@example\.com,pdf,chatgpt,yes,verified,2,3,/);
    assert.ok(!text.includes('chatgpt.com/share'), 'no links in the export');

    const raw = Buffer.from(await (await admin.get('/api/admin/export/users.csv')).arrayBuffer());
    assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 byte-order mark so Excel shows Unicode');
    const users = raw.toString('utf-8');
    assert.match(users, /^﻿account,role,status/);
    assert.match(users, /u@example\.com,user,active,1,0,0,1,default \(30\)/);

    assert.equal((await u.get('/api/admin/export/usage.csv')).status, 403);
  });
});

test('platform health check: saved test links, results per platform, one run at a time', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const { app } = await setup({ claude: async () => { await slow; return makeConversation(); } });
  await withServer(app, async (base) => {
    const admin = await login(base, 'boss@example.com');
    const u = await login(base, 'u@example.com');

    // Links are validated and must match their platform
    const wrong = await admin.put('/api/admin/health/links', { chatgpt: GEMINI });
    assert.equal(wrong.status, 400);
    assert.match((await wrong.json()).error.message, /is a Google Gemini link/);

    const saved = await admin.json('PUT', '/api/admin/health/links', { chatgpt: CHATGPT, gemini: GEMINI });
    assert.deepEqual(saved.data.links, { chatgpt: CHATGPT, gemini: GEMINI, claude: '' });
    assert.equal(typeof saved.data.scheduleHours, 'number');

    const run = (await admin.json('POST', '/api/admin/health/run')).data;
    assert.deepEqual(run.results.map((r) => [r.platform, r.ok, r.outcome]), [['chatgpt', true, 'verified'], ['gemini', false, 'NOT_FOUND']]);
    const byPlatform = Object.fromEntries(run.platforms.map((p) => [p.platform, p]));
    assert.equal(byPlatform.chatgpt.latest.ok, true);
    assert.match(byPlatform.chatgpt.latest.message, /Read 2 messages/);
    assert.equal(byPlatform.gemini.latest.ok, false);
    assert.equal(byPlatform.claude.configured, false);

    // A second check while one is running is refused
    await admin.put('/api/admin/health/links', { claude: 'https://claude.ai/share/0f0f0f0f-1111-4222-8333-444455556666' });
    const first = admin.post('/api/admin/health/run');
    await new Promise((r) => setTimeout(r, 100));
    const second = await admin.post('/api/admin/health/run');
    assert.equal(second.status, 503);
    release();
    assert.equal((await first).status, 200);

    assert.equal((await u.get('/api/admin/health')).status, 403);
  });
});
