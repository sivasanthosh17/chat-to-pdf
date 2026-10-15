/**
 * API service layer for communicating with the Express backend.
 *
 * Every function resolves (never rejects) to { ok: true, ... } or
 * { ok: false, error: { code, message, retryable, details? } } so components
 * can branch on the backend's stable error codes.
 */

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '') + '/api';

function networkError(err) {
  if (err?.name === 'AbortError') {
    return { code: 'CANCELLED', message: 'Conversion cancelled.', retryable: true };
  }
  return {
    code: 'NETWORK',
    message: 'Could not reach the conversion server. Check your connection and that the backend is running.',
    retryable: true
  };
}

async function readError(response) {
  const json = await response.json().catch(() => null);
  if (json?.error) {
    return {
      code: json.error.code || 'INTERNAL',
      message: json.error.message || `Request failed (HTTP ${response.status}).`,
      retryable: Boolean(json.error.retryable),
      details: json.error.details
    };
  }
  return {
    code: response.status >= 500 ? 'UPSTREAM_ERROR' : 'INTERNAL',
    message: `Request failed (HTTP ${response.status}).`,
    retryable: response.status >= 500
  };
}

async function postJson(path, body, signal) {
  return fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include', // session cookie (needed when the API is on another origin)
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, application/pdf' },
    body: JSON.stringify(body),
    signal
  });
}

/**
 * Checks server health status and measures round-trip latency.
 * @returns {Promise<{ ok: boolean, data?: any, latencyMs: number, error?: object }>}
 */
export async function checkServerHealth() {
  const started = performance.now();
  try {
    const response = await fetch(`${API_BASE_URL}/health`, { headers: { Accept: 'application/json' } });
    const latencyMs = Math.round(performance.now() - started);
    if (!response.ok) return { ok: false, latencyMs, error: await readError(response) };
    const json = await response.json();
    return { ok: true, latencyMs, data: json.data };
  } catch (err) {
    return { ok: false, latencyMs: Math.round(performance.now() - started), error: networkError(err) };
  }
}

/**
 * Validates a conversation URL and detects its platform (server-side SSRF guard).
 * @param {string} url
 * @param {AbortSignal} [signal]
 */
export async function validateUrl(url, signal) {
  try {
    const response = await postJson('/validate-url', { url }, signal);
    if (!response.ok) return { ok: false, error: await readError(response) };
    const json = await response.json();
    return { ok: true, data: json.data };
  } catch (err) {
    return { ok: false, error: networkError(err) };
  }
}

/**
 * Extracts and verifies a conversation without rendering a PDF (inspection).
 * @param {string} url
 * @param {string} platform - 'auto' | 'chatgpt' | 'gemini' | 'claude'
 * @param {AbortSignal} [signal]
 */
export async function extractConversation(url, platform, signal) {
  try {
    const response = await postJson('/extract', { url, platform }, signal);
    if (!response.ok) return { ok: false, error: await readError(response) };
    const json = await response.json();
    return { ok: true, conversation: json.data, verification: json.verification };
  } catch (err) {
    return { ok: false, error: networkError(err) };
  }
}

/**
 * Fetches supported platform metadata from the backend.
 */
export async function fetchSupportedPlatforms() {
  try {
    const response = await fetch(`${API_BASE_URL}/platforms`);
    if (!response.ok) return [];
    const json = await response.json();
    return json.data || [];
  } catch {
    return [];
  }
}

function base64ToBlob(base64, type) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * Converts a shared conversation URL to a PDF while reporting real progress.
 *
 * Uses POST /api/convert/stream, which emits one JSON object per line:
 * stage events as the server reaches each step, then the result (PDF as
 * base64) or an error. `onStage(stage, info)` is called for every stage.
 *
 * The returned `previewUrl` is an object URL owned by the caller, who must
 * revoke it when the result is discarded.
 *
 * @param {string} url
 * @param {string} platform
 * @param {{ signal?: AbortSignal, onStage?: (stage: string, info: object) => void, options?: object }} [settings]
 *   options = download options, e.g. { userMessageMaxLines: 5 }
 */
export async function convertToPdfStream(url, platform, { signal, onStage = () => {}, options } = {}) {
  let response;
  try {
    response = await postJson('/convert/stream', { url, platform, ...(options ? { options } : {}) }, signal);
  } catch (err) {
    return { ok: false, error: networkError(err) };
  }

  const contentType = response.headers.get('Content-Type') || '';
  if (!response.ok || !contentType.includes('application/x-ndjson')) {
    return { ok: false, error: await readError(response) };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handle = (event) => {
    if (event.type === 'stage') {
      const { stage, ...info } = event;
      delete info.type;
      onStage(stage, info);
      return null;
    }
    if (event.type === 'error') return { ok: false, error: event.error };
    if (event.type === 'result') {
      const blob = base64ToBlob(event.pdf, 'application/pdf');
      return {
        ok: true,
        ...event.meta,
        blob,
        previewUrl: URL.createObjectURL(blob),
        warningsTruncated: false
      };
    }
    return null; // ping
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const outcome = handle(JSON.parse(line));
        if (outcome) {
          reader.cancel().catch(() => {});
          return outcome;
        }
      }
      if (done) break;
    }
  } catch (err) {
    return { ok: false, error: networkError(err) };
  }

  return {
    ok: false,
    error: { code: 'NETWORK', message: 'The connection to the server closed before the PDF was ready.', retryable: true }
  };
}

function parseReportHeader(value) {
  if (!value) return null;
  try {
    return JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
}

/**
 * Converts a shared conversation URL to a PDF.
 *
 * Returns the raw Blob (the caller creates the object URL at click time, so
 * the browser never sees a revoked URL) plus the verification metadata sent
 * in response headers.
 *
 * @param {string} url
 * @param {string} platform
 * @param {AbortSignal} [signal]
 */
export async function convertToPdf(url, platform, signal) {
  try {
    const response = await postJson('/convert', { url, platform }, signal);
    const contentType = response.headers.get('Content-Type') || '';
    if (!response.ok || !contentType.includes('application/pdf')) {
      return { ok: false, error: await readError(response) };
    }

    const blob = await response.blob();
    const report = parseReportHeader(response.headers.get('X-Verification-Report'));

    let filename = 'conversation.pdf';
    const match = (response.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/);
    if (match) filename = match[1];

    return {
      ok: true,
      blob,
      filename,
      platform: response.headers.get('X-Platform') || null,
      grade: response.headers.get('X-Verification-Grade') || report?.grade || 'unverified',
      warnings: report?.warnings || [],
      warningsTruncated: Boolean(report?.truncated),
      notes: report?.notes || [],
      method: report?.method || null,
      regressionCheck: response.headers.get('X-Regression-Check') || 'unknown',
      messageCount: Number(response.headers.get('X-Message-Count') || 0),
      pageCount: Number(response.headers.get('X-Page-Count') || 0)
    };
  } catch (err) {
    return { ok: false, error: networkError(err) };
  }
}
