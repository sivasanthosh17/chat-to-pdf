/**
 * safeFetch.service.js
 *
 * SSRF-hardened HTTP client used by extractors for direct (non-browser)
 * retrieval.
 *
 *   - HTTPS only, exact-hostname allowlist per platform.
 *   - Redirects are NOT followed automatically: every hop is re-validated
 *     (protocol, allowlisted hostname, no IP literal, DNS resolves public).
 *   - Hard overall timeout via AbortSignal.
 *   - Response bodies are streamed with a byte ceiling so a hostile or broken
 *     upstream cannot exhaust server memory.
 *
 * Known limitation: Node's fetch re-resolves DNS when connecting, so a DNS
 * answer that changes between our check and the connection (rebinding) is not
 * fully excluded. Exposure is limited because only a handful of exact,
 * well-known platform hostnames are ever allowed.
 */

import { isIP } from 'node:net';
import { AppError } from '../utils/errors.js';
import { checkHostResolvesPublic } from './urlValidator.service.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 15_000;
const DEFAULT_MAX_BYTES = Number(process.env.FETCH_MAX_BYTES) || 25 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/**
 * Validates one hop of a request chain.
 * @returns {Promise<URL>}
 */
async function assertAllowedUrl(urlString, allowedHosts, { skipDns, lookupImpl }) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw new AppError('UNSUPPORTED_URL', 'Upstream redirect pointed to a malformed URL.');
  }

  if (url.protocol !== 'https:') {
    throw new AppError('UNSUPPORTED_URL', `Blocked non-HTTPS request (${url.protocol}).`);
  }
  const hostname = url.hostname.toLowerCase();
  if (isIP(hostname.replace(/^\[|\]$/g, '')) !== 0) {
    throw new AppError('UNSUPPORTED_URL', 'Blocked request to an IP-literal host.');
  }
  if (!allowedHosts.includes(hostname)) {
    throw new AppError('UNSUPPORTED_URL', `Blocked request to non-allowlisted host "${hostname}".`);
  }
  if (url.username || url.password || (url.port && url.port !== '443')) {
    throw new AppError('UNSUPPORTED_URL', 'Blocked request with credentials or a non-standard port.');
  }
  if (!skipDns) {
    const dns = await checkHostResolvesPublic(hostname, lookupImpl);
    if (!dns.ok) throw new AppError('UNSUPPORTED_URL', dns.error);
  }
  return url;
}

/**
 * Reads a response body up to maxBytes, aborting early if the limit is exceeded.
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<string>}
 */
export async function readBodyWithLimit(response, maxBytes = DEFAULT_MAX_BYTES) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AppError('RESPONSE_TOO_LARGE', `Upstream response is too large (${declared} bytes, limit ${maxBytes}).`);
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new AppError('RESPONSE_TOO_LARGE', `Upstream response exceeded the ${maxBytes}-byte limit.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');
}

/**
 * Performs a GET request with manual, re-validated redirects.
 *
 * @param {string} urlString
 * @param {object} options
 * @param {string[]} options.allowedHosts          - exact hostnames permitted for every hop
 * @param {object}   [options.headers]
 * @param {number}   [options.timeoutMs]
 * @param {number}   [options.maxBytes]
 * @param {boolean}  [options.skipDns]
 * @param {Function} [options.fetchImpl]          - injectable for tests
 * @param {Function} [options.lookupImpl]         - injectable for tests
 * @param {AbortSignal} [options.signal]          - caller cancellation
 * @returns {Promise<{ status: number, ok: boolean, url: string, headers: Headers, text: string }>}
 */
export async function safeFetch(urlString, options) {
  const {
    allowedHosts,
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    skipDns = false,
    fetchImpl = fetch,
    lookupImpl,
    signal: callerSignal
  } = options;

  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
    throw new AppError('INTERNAL', 'safeFetch requires a non-empty host allowlist.');
  }
  if (callerSignal?.aborted) throw new AppError('CANCELLED', 'The conversion was cancelled.');

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal ? AbortSignal.any([timeoutSignal, callerSignal]) : timeoutSignal;
  let current = urlString;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = await assertAllowedUrl(current, allowedHosts, { skipDns, lookupImpl });

      const response = await fetchImpl(url.href, {
        method: 'GET',
        headers: { 'User-Agent': BROWSER_USER_AGENT, ...headers },
        redirect: 'manual',
        signal
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel?.().catch(() => {});
        if (!location) {
          throw new AppError('UPSTREAM_ERROR', `Upstream returned redirect ${response.status} without a Location header.`);
        }
        current = new URL(location, url).href;
        continue;
      }

      const text = await readBodyWithLimit(response, maxBytes);
      return { status: response.status, ok: response.ok, url: url.href, headers: response.headers, text };
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (callerSignal?.aborted) {
      throw new AppError('CANCELLED', 'The conversion was cancelled.');
    }
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new AppError('TIMEOUT', `Request timed out after ${timeoutMs} ms.`);
    }
    throw new AppError('UPSTREAM_ERROR', `Network error while contacting the platform (${err?.cause?.code || err?.message || 'unknown'}).`);
  }

  throw new AppError('UPSTREAM_ERROR', `Too many redirects (more than ${MAX_REDIRECTS}).`);
}
