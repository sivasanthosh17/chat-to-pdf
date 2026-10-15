import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateConversationUrl,
  isPrivateOrReservedIPv4,
  isPrivateOrReservedIPv6
} from '../src/services/urlValidator.service.js';

test('SSRF Guard: isPrivateOrReservedIPv4 blocks dangerous IP ranges', () => {
  // Loopback
  assert.equal(isPrivateOrReservedIPv4('127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIPv4('127.255.255.254'), true);

  // Cloud metadata endpoint (AWS / GCP / Azure)
  assert.equal(isPrivateOrReservedIPv4('169.254.169.254'), true);
  assert.equal(isPrivateOrReservedIPv4('169.254.1.1'), true);

  // Private RFC 1918
  assert.equal(isPrivateOrReservedIPv4('10.0.0.1'), true);
  assert.equal(isPrivateOrReservedIPv4('192.168.1.1'), true);
  assert.equal(isPrivateOrReservedIPv4('172.16.0.1'), true);
  assert.equal(isPrivateOrReservedIPv4('172.31.255.255'), true);

  // Broadcast / Zero
  assert.equal(isPrivateOrReservedIPv4('0.0.0.0'), true);

  // Public IP (e.g. Cloudflare DNS, Google DNS)
  assert.equal(isPrivateOrReservedIPv4('1.1.1.1'), false);
  assert.equal(isPrivateOrReservedIPv4('8.8.8.8'), false);
});

test('SSRF Guard: isPrivateOrReservedIPv6 blocks IPv6 loopback and link-local', () => {
  assert.equal(isPrivateOrReservedIPv6('::1'), true);
  assert.equal(isPrivateOrReservedIPv6('fe80::1'), true);
  assert.equal(isPrivateOrReservedIPv6('fc00::1'), true);
  assert.equal(isPrivateOrReservedIPv6('::ffff:127.0.0.1'), true);
});

test('URL Validator: Validates ChatGPT share links correctly', async () => {
  const result1 = await validateConversationUrl('https://chatgpt.com/share/67a91234-abcd', { skipDns: true });
  assert.equal(result1.isValid, true);
  assert.equal(result1.platform, 'chatgpt');
  assert.equal(result1.shareId, '67a91234-abcd');

  const result2 = await validateConversationUrl('https://chat.openai.com/share/e_98765-xyz', { skipDns: true });
  assert.equal(result2.isValid, true);
  assert.equal(result2.platform, 'chatgpt');
  assert.equal(result2.shareId, 'e_98765-xyz');
});

test('URL Validator: Validates Google Gemini share links correctly', async () => {
  const result = await validateConversationUrl('https://gemini.google.com/share/abc123456789', { skipDns: true });
  assert.equal(result.isValid, true);
  assert.equal(result.platform, 'gemini');
  assert.equal(result.shareId, 'abc123456789');
});

test('URL Validator: Validates Claude share links correctly', async () => {
  const result = await validateConversationUrl('https://claude.ai/share/7b32f91-234', { skipDns: true });
  assert.equal(result.isValid, true);
  assert.equal(result.platform, 'claude');
  assert.equal(result.shareId, '7b32f91-234');
});

test('URL Validator: Rejects non-HTTPS protocols', async () => {
  const result = await validateConversationUrl('http://chatgpt.com/share/12345', { skipDns: true });
  assert.equal(result.isValid, false);
  assert.ok(result.error.includes('Only HTTPS URLs are permitted'));
});

test('URL Validator: Rejects direct IP literals', async () => {
  const result1 = await validateConversationUrl('https://127.0.0.1/share/12345', { skipDns: true });
  assert.equal(result1.isValid, false);
  assert.ok(result1.error.includes('Direct IP address access is disallowed'));

  const result2 = await validateConversationUrl('https://169.254.169.254/latest', { skipDns: true });
  assert.equal(result2.isValid, false);
  assert.ok(result2.error.includes('Direct IP address access is disallowed'));
});

test('URL Validator: Rejects unsupported hosts', async () => {
  const result = await validateConversationUrl('https://evil-hacker.com/share/12345', { skipDns: true });
  assert.equal(result.isValid, false);
  assert.ok(result.error.includes('Unsupported hostname'));
});

test('URL Validator: Rejects invalid path formats for supported domains', async () => {
  const result = await validateConversationUrl('https://chatgpt.com/c/not-a-public-share-link', { skipDns: true });
  assert.equal(result.isValid, false);
  assert.ok(result.error.includes('Invalid path'));
});

test('URL Validator: /share/e/<id> uses the last path segment as share id', async () => {
  const result = await validateConversationUrl('https://chatgpt.com/share/e/5f3c0a9e-1234', { skipDns: true });
  assert.equal(result.isValid, true);
  assert.equal(result.shareId, '5f3c0a9e-1234');
  assert.equal(result.canonicalUrl, 'https://chatgpt.com/share/e/5f3c0a9e-1234');
});

test('URL Validator: g.co/gemini/share short links are rewritten locally to the canonical URL', async () => {
  const result = await validateConversationUrl('https://g.co/gemini/share/a1b2c3d4e5f6', { skipDns: true });
  assert.equal(result.isValid, true);
  assert.equal(result.platform, 'gemini');
  assert.equal(result.shareId, 'a1b2c3d4e5f6');
  assert.equal(result.canonicalUrl, 'https://gemini.google.com/share/a1b2c3d4e5f6');

  const other = await validateConversationUrl('https://g.co/maps/abc', { skipDns: true });
  assert.equal(other.isValid, false);
});

test('URL Validator: share.gemini.google short links are resolved with one non-followed request', async () => {
  const seen = [];
  const redirectTo = (location, status = 301) => async (url, init) => {
    seen.push({ url, redirect: init.redirect });
    return new Response(null, { status, headers: location ? { location } : {} });
  };

  const ok = await validateConversationUrl('https://share.gemini.google/1AbCdEfGhIj', {
    skipDns: true,
    fetchImpl: redirectTo('https://gemini.google.com/share/0a1b2c3d4e5f?social_preview=false&skid=x')
  });
  assert.equal(ok.isValid, true);
  assert.equal(ok.platform, 'gemini');
  assert.equal(ok.shareId, '0a1b2c3d4e5f');
  assert.equal(ok.canonicalUrl, 'https://gemini.google.com/share/0a1b2c3d4e5f');
  assert.equal(ok.shortLink, 'https://share.gemini.google/1AbCdEfGhIj');
  assert.deepEqual(seen, [{ url: 'https://share.gemini.google/1AbCdEfGhIj', redirect: 'manual' }]);

  // Redirects anywhere else are rejected (and never followed)
  for (const target of ['https://evil.example/share/x', 'http://169.254.169.254/latest', 'https://chatgpt.com/share/abc', 'https://share.gemini.google/loop']) {
    const bad = await validateConversationUrl('https://share.gemini.google/1AbCdEfGhIj', { skipDns: true, fetchImpl: redirectTo(target) });
    assert.equal(bad.isValid, false, target);
  }

  const missing = await validateConversationUrl('https://share.gemini.google/1AbCdEfGhIj', { skipDns: true, fetchImpl: redirectTo(null, 404) });
  assert.equal(missing.isValid, false);
  assert.match(missing.error, /does not point to a shared conversation/);

  const down = await validateConversationUrl('https://share.gemini.google/1AbCdEfGhIj', {
    skipDns: true,
    fetchImpl: async () => { throw new TypeError('fetch failed'); }
  });
  assert.match(down.error, /Could not reach share.gemini.google/);

  const badPath = await validateConversationUrl('https://share.gemini.google/a/b', { skipDns: true, fetchImpl: redirectTo('x') });
  assert.equal(badPath.isValid, false);
});

test('URL Validator: query strings and fragments are dropped from the canonical URL', async () => {
  const result = await validateConversationUrl('https://chatgpt.com/share/abc-123?ogimg=plain#x', { skipDns: true });
  assert.equal(result.canonicalUrl, 'https://chatgpt.com/share/abc-123');
});

test('URL Validator: rejects credentials, non-standard ports and lookalike hosts', async () => {
  for (const url of [
    'https://user:pass@chatgpt.com/share/abc',
    'https://chatgpt.com:8443/share/abc',
    'https://chatgpt.com.evil.example/share/abc',
    'https://evilchatgpt.com/share/abc',
    'https://[::1]/share/abc',
    'https://0x7f000001/share/abc',
    'javascript:alert(1)',
    'file:///etc/passwd'
  ]) {
    const result = await validateConversationUrl(url, { skipDns: true });
    assert.equal(result.isValid, false, url);
  }
});

test('URL Validator: DNS answers pointing at private, loopback or metadata ranges are rejected', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '100.64.0.1', '192.168.0.10']) {
    const result = await validateConversationUrl('https://chatgpt.com/share/abc', { lookupImpl: async () => [{ address, family: 4 }] });
    assert.equal(result.isValid, false, address);
    assert.match(result.error, /private or reserved/);
  }
  const v6 = await validateConversationUrl('https://chatgpt.com/share/abc', { lookupImpl: async () => [{ address: 'fd12:3456::1', family: 6 }] });
  assert.equal(v6.isValid, false);

  const ok = await validateConversationUrl('https://chatgpt.com/share/abc', { lookupImpl: async () => [{ address: '104.18.32.47', family: 4 }] });
  assert.equal(ok.isValid, true);

  const dnsFail = await validateConversationUrl('https://chatgpt.com/share/abc', {
    lookupImpl: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); }
  });
  assert.equal(dnsFail.isValid, false);
  assert.match(dnsFail.error, /DNS resolution failed/);
});

test('SSRF Guard: extended reserved ranges', () => {
  assert.equal(isPrivateOrReservedIPv4('100.64.0.1'), true); // CGNAT
  assert.equal(isPrivateOrReservedIPv4('198.18.0.1'), true); // benchmarking
  assert.equal(isPrivateOrReservedIPv4('203.0.113.5'), true); // TEST-NET-3
  assert.equal(isPrivateOrReservedIPv6('fd12:3456::1'), true); // unique-local beyond fd00:
  assert.equal(isPrivateOrReservedIPv6('febf::1'), true); // link-local upper bound
  assert.equal(isPrivateOrReservedIPv6('::ffff:7f00:1'), true); // hex-form IPv4-mapped loopback
  assert.equal(isPrivateOrReservedIPv6('2606:4700::1'), false);
});
