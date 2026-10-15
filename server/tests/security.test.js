/**
 * Security tests: SSRF-safe fetching (redirects, DNS, size, timeouts),
 * headless-browser network policy and rate limiting.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { safeFetch } from '../src/services/safeFetch.service.js';
import { isBrowserRequestAllowed } from '../src/services/browser.service.js';
import { createRateLimiter } from '../src/middleware/rateLimiter.js';

const publicDns = async () => [{ address: '104.18.32.47', family: 4 }];
const allowedHosts = ['chatgpt.com'];

function redirectTo(location, status = 302) {
  return new Response(null, { status, headers: { location } });
}

test('safeFetch: follows an allowlisted redirect and re-validates it', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return seen.length === 1 ? redirectTo('/backend-api/share/abc') : new Response('{"ok":true}', { status: 200 });
  };
  const res = await safeFetch('https://chatgpt.com/share/abc', { allowedHosts, fetchImpl, lookupImpl: publicDns });
  assert.equal(res.status, 200);
  assert.deepEqual(seen, ['https://chatgpt.com/share/abc', 'https://chatgpt.com/backend-api/share/abc']);
});

test('safeFetch: blocks redirects to other hosts, plain HTTP, IP literals and metadata endpoints', async () => {
  const targets = [
    'https://evil.example/steal',
    'http://chatgpt.com/downgrade',
    'https://127.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data/',
    'https://[::1]/',
    'https://user:pass@chatgpt.com/'
  ];
  for (const target of targets) {
    let calls = 0;
    const fetchImpl = async () => (++calls === 1 ? redirectTo(target) : new Response('should not be reached'));
    await assert.rejects(
      safeFetch('https://chatgpt.com/share/abc', { allowedHosts, fetchImpl, lookupImpl: publicDns }),
      (err) => err.code === 'UNSUPPORTED_URL',
      target
    );
    assert.equal(calls, 1, `no request may be made to ${target}`);
  }
});

test('safeFetch: rejects an allowlisted host whose DNS points at a private address', async () => {
  const privateDns = async () => [{ address: '10.0.0.5', family: 4 }];
  await assert.rejects(
    safeFetch('https://chatgpt.com/share/abc', { allowedHosts, fetchImpl: async () => new Response('x'), lookupImpl: privateDns }),
    (err) => err.code === 'UNSUPPORTED_URL' && /private or reserved/.test(err.message)
  );
});

test('safeFetch: stops after too many redirects', async () => {
  let n = 0;
  const fetchImpl = async () => redirectTo(`/hop/${++n}`);
  await assert.rejects(
    safeFetch('https://chatgpt.com/start', { allowedHosts, fetchImpl, lookupImpl: publicDns }),
    (err) => err.code === 'UPSTREAM_ERROR' && /redirects/.test(err.message)
  );
});

test('safeFetch: enforces the response size limit (declared and streamed)', async () => {
  const declared = async () => new Response('x', { status: 200, headers: { 'content-length': '999999' } });
  await assert.rejects(
    safeFetch('https://chatgpt.com/a', { allowedHosts, fetchImpl: declared, lookupImpl: publicDns, maxBytes: 1000 }),
    (err) => err.code === 'RESPONSE_TOO_LARGE'
  );

  const streamed = async () => new Response(new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(600));
    }
  }));
  await assert.rejects(
    safeFetch('https://chatgpt.com/a', { allowedHosts, fetchImpl: streamed, lookupImpl: publicDns, maxBytes: 1000 }),
    (err) => err.code === 'RESPONSE_TOO_LARGE'
  );
});

test('safeFetch: times out hanging requests', async () => {
  const hanging = (url, { signal }) => new Promise((_, reject) => {
    const keepAlive = setTimeout(() => {}, 5_000);
    signal.addEventListener('abort', () => {
      clearTimeout(keepAlive);
      reject(signal.reason);
    });
  });
  await assert.rejects(
    safeFetch('https://chatgpt.com/a', { allowedHosts, fetchImpl: hanging, lookupImpl: publicDns, timeoutMs: 50 }),
    (err) => err.code === 'TIMEOUT'
  );
});

test('safeFetch: refuses to run without an allowlist', async () => {
  await assert.rejects(safeFetch('https://chatgpt.com/a', { allowedHosts: [] }), (err) => err.code === 'INTERNAL');
});

// ── Browser network policy ───────────────────────────────────────────────────

test('browser policy: allows only HTTPS requests to allowlisted host suffixes', () => {
  const suffixes = ['gemini.google.com', 'gstatic.com'];
  const ok = (url, type = 'script') => isBrowserRequestAllowed(url, suffixes, type);

  assert.equal(ok('https://gemini.google.com/share/x', 'document'), true);
  assert.equal(ok('https://www.gstatic.com/app.js'), true);
  assert.equal(ok('https://evilgstatic.com/x'), false, 'suffix must match a label boundary');
  assert.equal(ok('https://gemini.google.com.evil.example/x'), false);
  assert.equal(ok('http://gemini.google.com/x'), false);
  assert.equal(ok('https://169.254.169.254/latest'), false);
  assert.equal(ok('https://[::1]/'), false);
  assert.equal(ok('https://gemini.google.com:8443/x'), false);
  assert.equal(ok('file:///etc/passwd'), false);
  assert.equal(ok('https://www.googletagmanager.com/gtm.js'), false);
  assert.equal(ok('https://www.gstatic.com/logo.png', 'image'), false, 'images are not downloaded');
  assert.equal(ok('data:text/plain,hello', 'other'), true);
});

test('browser policy: an empty allowlist blocks all network access (PDF rendering)', () => {
  assert.equal(isBrowserRequestAllowed('https://example.com/', [], 'stylesheet'), false);
});

// ── Rate limiter ─────────────────────────────────────────────────────────────

test('rate limiter: allows up to max per window per IP, then 429 with Retry-After', () => {
  let clock = 0;
  const limiter = createRateLimiter({ windowMs: 1000, max: 2, now: () => clock });
  const run = (ip) => {
    const headers = {};
    let error = null;
    limiter({ ip }, { setHeader: (k, v) => { headers[k] = v; } }, (err) => { error = err || null; });
    return { headers, error };
  };

  assert.equal(run('1.1.1.1').error, null);
  assert.equal(run('1.1.1.1').error, null);
  const third = run('1.1.1.1');
  assert.equal(third.error.code, 'RATE_LIMITED');
  assert.equal(third.error.statusCode, 429);
  assert.ok(Number(third.headers['Retry-After']) > 0);

  assert.equal(run('2.2.2.2').error, null, 'other clients are unaffected');

  clock = 1001;
  assert.equal(run('1.1.1.1').error, null, 'window resets');
});
