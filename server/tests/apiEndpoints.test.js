/**
 * API endpoint tests. Extractors are injected through createApp(), so no
 * test depends on a live platform; PDF rendering uses a stub here and the
 * real renderer in pdfRendering.test.js.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { AppError } from '../src/utils/errors.js';
import { parseChatGptSharePayload } from '../src/extractors/chatgpt.extractor.js';
import { jsonFixture, withServer, postJson, makeConversation } from './helpers.js';

const offline = { validatorOptions: { skipDns: true } };
const CHATGPT_URL = 'https://chatgpt.com/share/fixture-conversation';

const fixtureExtractor = async (validation) =>
  parseChatGptSharePayload(jsonFixture('chatgpt-share-payload.json'), validation.canonicalUrl);

const stubPdf = async (conversation, report) => ({
  buffer: Buffer.from('%PDF-1.4\n% stub\n'),
  regressionCheck: { passed: true, checkedCount: 1, failureCount: 0, failures: [] },
  report,
  pageCount: 1
});

function app(extra = {}) {
  return createApp({ ...offline, renderPdf: stubPdf, extractors: { chatgpt: fixtureExtractor }, ...extra });
}

// ── Health / platforms / validation ──────────────────────────────────────────

test('GET /api/health returns status and conversion capacity', async () => {
  await withServer(app(), async (base) => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.status, 'ok');
    assert.equal(body.data.service, 'chat-to-pdf-server');
    assert.equal(typeof body.data.conversionCapacity.maxConcurrency, 'number');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});

test('GET /api/platforms lists every platform with its verification level', async () => {
  await withServer(app(), async (base) => {
    const body = await (await fetch(`${base}/api/platforms`)).json();
    const byId = Object.fromEntries(body.data.map((p) => [p.id, p]));
    assert.equal(byId.chatgpt.verification, 'independent');
    assert.equal(byId.gemini.verification, 'unverified');
    assert.equal(byId.claude.verification, 'unverified');
  });
});

test('POST /api/validate-url detects each platform (including g.co short links)', async () => {
  await withServer(app(), async (base) => {
    for (const [url, platform] of [
      ['https://chatgpt.com/share/abc-123', 'chatgpt'],
      ['https://g.co/gemini/share/a1b2c3d4e5f6', 'gemini'],
      ['https://claude.ai/share/0f0f0f0f-1111-4222-8333-444455556666', 'claude']
    ]) {
      const body = await (await postJson(base, '/api/validate-url', { url })).json();
      assert.equal(body.data.platform, platform, url);
    }
  });
});

test('POST /api/validate-url rejects unsupported / malicious URLs with 422', async () => {
  await withServer(app(), async (base) => {
    for (const url of ['https://attacker.example/x', 'http://chatgpt.com/share/a', 'https://169.254.169.254/latest']) {
      const res = await postJson(base, '/api/validate-url', { url });
      assert.equal(res.status, 422, url);
      assert.equal((await res.json()).error.code, 'UNSUPPORTED_URL');
    }
  });
});

test('invalid bodies: missing url → 400, malformed JSON → 400, oversized body → 413', async () => {
  await withServer(app(), async (base) => {
    const missing = await postJson(base, '/api/convert', {});
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error.code, 'INVALID_REQUEST');

    const malformed = await postJson(base, '/api/convert', '{"url":');
    assert.equal(malformed.status, 400);

    const huge = await postJson(base, '/api/convert', { url: 'https://chatgpt.com/share/a', pad: 'x'.repeat(20_000) });
    assert.equal(huge.status, 413);
  });
});

test('unknown endpoint → structured 404', async () => {
  await withServer(app(), async (base) => {
    const res = await fetch(`${base}/api/unknown-endpoint`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.error.message.includes('not found'));
  });
});

// ── /api/extract ─────────────────────────────────────────────────────────────

test('POST /api/extract returns the normalized conversation and its verification report', async () => {
  await withServer(app(), async (base) => {
    const res = await postJson(base, '/api/extract', { url: CHATGPT_URL });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.platform, 'chatgpt');
    assert.equal(body.data.messages.length, 7);
    assert.equal(body.verification.grade, 'verified_with_warnings');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
});

// ── /api/convert ─────────────────────────────────────────────────────────────

test('POST /api/convert streams a PDF with verification headers', async () => {
  await withServer(app(), async (base) => {
    const res = await postJson(base, '/api/convert', { url: CHATGPT_URL, platform: 'auto' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition'), /attachment; filename="chatgpt-Synthetic_fixture_share_payload\.pdf"/);
    assert.equal(res.headers.get('x-verification-grade'), 'verified_with_warnings');
    assert.equal(res.headers.get('x-message-count'), '7');
    assert.equal(res.headers.get('x-regression-check'), 'passed');
    assert.match(res.headers.get('cache-control'), /no-store/);

    const report = JSON.parse(decodeURIComponent(res.headers.get('x-verification-report')));
    assert.equal(report.grade, 'verified_with_warnings');
    assert.ok(report.warnings.some((w) => w.includes('tool call')));

    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  });
});

test('POST /api/convert rejects a platform that does not match the URL', async () => {
  await withServer(app(), async (base) => {
    const res = await postJson(base, '/api/convert', { url: CHATGPT_URL, platform: 'gemini' });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error.code, 'PLATFORM_MISMATCH');
  });
});

test('POST /api/convert maps extractor failures to distinct status codes', async () => {
  const cases = [
    [new AppError('NOT_FOUND', 'private or deleted'), 404, 'NOT_FOUND', false],
    [new AppError('ACCESS_BLOCKED', 'bot check'), 403, 'ACCESS_BLOCKED', false],
    [new AppError('TIMEOUT', 'slow'), 504, 'TIMEOUT', true],
    [new AppError('UPSTREAM_ERROR', 'down'), 502, 'UPSTREAM_ERROR', true],
    [new AppError('BUSY', 'busy'), 503, 'BUSY', true],
    [new TypeError('fetch failed'), 502, 'UPSTREAM_ERROR', true],
    [new Error('something internal at /secret/path'), 502, 'EXTRACTION_FAILED', true]
  ];
  for (const [error, status, code, retryable] of cases) {
    const failing = async () => {
      throw error;
    };
    await withServer(app({ extractors: { chatgpt: failing } }), async (base) => {
      const res = await postJson(base, '/api/convert', { url: CHATGPT_URL });
      assert.equal(res.status, status, code);
      const body = await res.json();
      assert.equal(body.error.code, code);
      assert.equal(body.error.retryable, retryable);
      assert.ok(!body.error.message.includes('/secret/path'), 'internal details are not leaked');
    });
  }
});

test('POST /api/convert blocks the PDF when verification fails', async () => {
  const broken = async () => {
    const conv = makeConversation();
    conv.messages[1].structuredBlocks = [{ type: 'paragraph', text: 'truncated' }];
    return conv;
  };
  let rendered = false;
  const spyPdf = async (...args) => {
    rendered = true;
    return stubPdf(...args);
  };
  await withServer(app({ extractors: { chatgpt: broken }, renderPdf: spyPdf }), async (base) => {
    const res = await postJson(base, '/api/convert', { url: CHATGPT_URL });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.error.code, 'VERIFICATION_FAILED');
    assert.equal(body.error.details.grade, 'failed');
    assert.ok(body.error.details.verificationErrors.length > 0);
    assert.equal(rendered, false, 'no PDF is rendered');
  });
});

test('POST /api/convert: PDF renderer failure → 500 PDF_FAILED', async () => {
  const failingPdf = async () => {
    throw new Error('chromium crashed');
  };
  await withServer(app({ renderPdf: failingPdf }), async (base) => {
    const res = await postJson(base, '/api/convert', { url: CHATGPT_URL });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error.code, 'PDF_FAILED');
  });
});

test('POST /api/convert is rate limited per client (429 + Retry-After)', async () => {
  await withServer(app({ rateLimits: { conversion: 2 } }), async (base) => {
    assert.equal((await postJson(base, '/api/convert', { url: CHATGPT_URL })).status, 200);
    assert.equal((await postJson(base, '/api/convert', { url: CHATGPT_URL })).status, 200);
    const limited = await postJson(base, '/api/convert', { url: CHATGPT_URL });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal((await limited.json()).error.code, 'RATE_LIMITED');
  });
});

test('built frontend is served from the same origin with its own CSP; /api stays JSON', async () => {
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'chatpdf-dist-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>app</title>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'app-123.js'), 'console.log(1)');

    await withServer(app({ clientDistDir: dir }), async (base) => {
      const index = await fetch(`${base}/`);
      assert.equal(index.status, 200);
      assert.match(await index.text(), /<title>app<\/title>/);
      assert.match(index.headers.get('content-security-policy'), /script-src 'self'/);

      const deepLink = await fetch(`${base}/some/route`);
      assert.equal(deepLink.status, 200, 'SPA fallback');

      const asset = await fetch(`${base}/assets/app-123.js`);
      assert.match(asset.headers.get('cache-control'), /immutable/);

      const api = await fetch(`${base}/api/does-not-exist`);
      assert.equal(api.status, 404);
      assert.equal((await api.json()).success, false);
      assert.equal(api.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CORS: allowed origin gets exposed verification headers; other origins get none', async () => {
  await withServer(app(), async (base) => {
    const ok = await fetch(`${base}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.match(ok.headers.get('access-control-expose-headers'), /X-Verification-Report/);

    const evil = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
  });
});
