/**
 * browser.service.js
 *
 * Single entry point for every headless Chromium session (extraction and PDF
 * rendering). Centralising it lets us enforce, in one place:
 *
 *   - Network restriction: every request the page makes is checked against an
 *     HTTPS host-suffix allowlist; anything else (other hosts, IP literals,
 *     plain HTTP, internal addresses) is aborted. WebSockets and service
 *     workers are blocked.
 *   - Resource limits: images, media and fonts are not downloaded during
 *     extraction (they are never embedded in the PDF).
 *   - Concurrency: at most BROWSER_MAX_CONCURRENCY Chromium instances run at
 *     once; a bounded queue absorbs bursts and anything beyond it is rejected
 *     with a 503 instead of exhausting server memory.
 *   - Timeouts: each job has a hard deadline after which the browser is killed.
 *   - Cleanup: the browser is always closed, even on error or timeout.
 */

import { chromium } from 'playwright';
import { isIP } from 'node:net';
import { AppError } from '../utils/errors.js';
import { BROWSER_USER_AGENT } from './safeFetch.service.js';

const MAX_CONCURRENCY = Math.max(1, Number(process.env.BROWSER_MAX_CONCURRENCY) || 2);
const MAX_QUEUE = Math.max(0, Number(process.env.BROWSER_MAX_QUEUE) || 8);
const QUEUE_WAIT_MS = Number(process.env.BROWSER_QUEUE_WAIT_MS) || 60_000;
const DEFAULT_JOB_TIMEOUT_MS = Number(process.env.BROWSER_JOB_TIMEOUT_MS) || 90_000;

const DEFAULT_BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

// ── Concurrency limiter ─────────────────────────────────────────────────────

let active = 0;
const waiters = [];

function cancelledError() {
  return new AppError('CANCELLED', 'The conversion was cancelled.');
}

function acquireSlot(signal) {
  if (signal?.aborted) return Promise.reject(cancelledError());
  if (active < MAX_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  if (waiters.length >= MAX_QUEUE) {
    return Promise.reject(new AppError('BUSY', 'The server is busy with other conversions. Please retry in a minute.'));
  }
  return new Promise((resolve, reject) => {
    const leave = (error) => {
      const i = waiters.indexOf(waiter);
      if (i !== -1) waiters.splice(i, 1);
      clearTimeout(waiter.timer);
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    };
    const onAbort = () => leave(cancelledError());
    const waiter = {
      resolve: () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
      timer: setTimeout(() => leave(new AppError('BUSY', 'Timed out waiting for a free conversion slot. Please retry.')), QUEUE_WAIT_MS)
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    waiters.push(waiter);
  });
}

function releaseSlot() {
  const next = waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve(); // slot is handed over directly; `active` is unchanged
  } else {
    active = Math.max(0, active - 1);
  }
}

/** Current limiter state — exposed for the health endpoint and tests. */
export function getBrowserPoolStats() {
  return { active, queued: waiters.length, maxConcurrency: MAX_CONCURRENCY, maxQueue: MAX_QUEUE };
}

// ── Network policy ──────────────────────────────────────────────────────────

/**
 * Decides whether a browser request may proceed.
 *
 * @param {string} urlString
 * @param {string[]} hostSuffixes - e.g. ['gemini.google.com', 'gstatic.com']
 * @param {string} resourceType   - Playwright resource type
 * @param {Set<string>} [blockedTypes]
 * @returns {boolean}
 */
export function isBrowserRequestAllowed(urlString, hostSuffixes, resourceType, blockedTypes = DEFAULT_BLOCKED_RESOURCE_TYPES) {
  if (blockedTypes.has(resourceType)) return false;

  let url;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }

  // data: and blob: URLs never leave the browser process
  if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
  if (url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) return false;
  if (url.port && url.port !== '443') return false;

  return hostSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

// ── Job runner ──────────────────────────────────────────────────────────────

/**
 * Runs `fn(page, context)` inside a fresh, network-restricted Chromium.
 *
 * @template T
 * @param {(page: import('playwright').Page, ctx: { blockedRequests: string[] }) => Promise<T>} fn
 * @param {object} options
 * @param {string[]} options.hostSuffixes          - allowlist; [] blocks all network access
 * @param {number}   [options.timeoutMs]
 * @param {boolean}  [options.javaScriptEnabled=true]
 * @param {Set<string>} [options.blockedResourceTypes]
 * @param {AbortSignal} [options.signal]           - aborting stops the job and closes the browser
 * @returns {Promise<T>}
 */
export async function withBrowserPage(fn, options) {
  const {
    hostSuffixes,
    timeoutMs = DEFAULT_JOB_TIMEOUT_MS,
    javaScriptEnabled = true,
    blockedResourceTypes = DEFAULT_BLOCKED_RESOURCE_TYPES,
    signal
  } = options;

  await acquireSlot(signal);

  let browser = null;
  let timer = null;
  let finished = false;
  let onAbort = null;
  const blockedRequests = [];

  try {
    const launchOptions = {
      headless: true,
      args: ['--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions'],
      timeout: 30_000,
      // Playwright launches Chromium without its OS sandbox by default. Enable
      // it wherever the host supports it (desktop OSes; containers need a
      // seccomp profile that permits user namespaces — see README).
      chromiumSandbox: process.env.PLAYWRIGHT_CHROMIUM_SANDBOX === 'true'
    };
    if (process.env.PLAYWRIGHT_CHROMIUM_PATH) {
      launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
    }

    const job = (async () => {
      browser = await chromium.launch(launchOptions);
      if (finished) {
        // The deadline already fired while Chromium was starting
        await browser.close().catch(() => {});
        throw new AppError('TIMEOUT', 'Browser job was cancelled.');
      }
      const context = await browser.newContext({
        userAgent: BROWSER_USER_AGENT,
        locale: 'en-US',
        viewport: { width: 1280, height: 900 },
        javaScriptEnabled,
        serviceWorkers: 'block',
        acceptDownloads: false
      });

      await context.route('**/*', (route) => {
        const request = route.request();
        if (isBrowserRequestAllowed(request.url(), hostSuffixes, request.resourceType(), blockedResourceTypes)) {
          return route.continue();
        }
        if (blockedRequests.length < 50) blockedRequests.push(request.url().slice(0, 120));
        return route.abort('blockedbyclient');
      });

      if (typeof context.routeWebSocket === 'function') {
        await context.routeWebSocket(/.*/, (ws) => ws.close());
      }

      const page = await context.newPage();
      page.setDefaultTimeout(Math.min(timeoutMs, 30_000));
      page.setDefaultNavigationTimeout(Math.min(timeoutMs, 45_000));
      return fn(page, { blockedRequests });
    })();

    const deadline = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new AppError('TIMEOUT', `Browser job exceeded ${Math.round(timeoutMs / 1000)} s and was stopped.`)),
        timeoutMs
      );
    });

    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(cancelledError());
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });

    job.catch(() => {}); // a late rejection after the deadline must not become unhandled
    return await Promise.race([job, deadline, cancelled]);
  } finally {
    finished = true;
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    if (browser) await browser.close().catch(() => {});
    releaseSlot();
  }
}
