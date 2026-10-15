/**
 * Streaming conversion (POST /api/convert/stream) and cancellation tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/utils/errors.js';
import { parseChatGptSharePayload } from '../src/extractors/chatgpt.extractor.js';
import { withBrowserPage, getBrowserPoolStats } from '../src/services/browser.service.js';
import { jsonFixture, withServer, postJson, testApp } from './helpers.js';

const URL = 'https://chatgpt.com/share/fixture-conversation';

const fixtureExtractor = async (validation) =>
  parseChatGptSharePayload(jsonFixture('chatgpt-share-payload.json'), validation.canonicalUrl);

const stubPdf = async (conversation, report, { onStage = () => {} } = {}) => {
  onStage('rendering');
  onStage('checking');
  return {
    buffer: Buffer.from('%PDF-1.4\n% stub\n'),
    regressionCheck: { passed: true, checkedCount: 1, failureCount: 0, failures: [] },
    report,
    pageCount: 3
  };
};

function app(extra = {}) {
  return testApp({ renderPdf: stubPdf, extractors: { chatgpt: fixtureExtractor }, ...extra });
}

async function readEvents(res) {
  const text = await res.text();
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/** Resolves when the extractor's AbortSignal fires (or after a safety timeout). */
function hangingExtractor(seen) {
  return (validation, { signal }) => new Promise((_, reject) => {
    const safety = setTimeout(() => reject(new AppError('EXTRACTION_FAILED', 'safety timeout')), 10_000);
    signal.addEventListener('abort', () => {
      clearTimeout(safety);
      seen.aborted = true;
      reject(new AppError('CANCELLED', 'cancelled'));
    });
  });
}

test('stream: emits real stages in order, then the PDF and its verification metadata', async () => {
  await withServer(app(), async (base) => {
    const res = await postJson(base, '/api/convert/stream', { url: URL });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/x-ndjson/);
    assert.match(res.headers.get('cache-control'), /no-store/);

    const events = await readEvents(res);
    const stages = events.filter((e) => e.type === 'stage').map((e) => e.stage);
    assert.deepEqual(stages, ['validating', 'retrieving', 'verifying', 'rendering', 'checking']);
    assert.equal(events.find((e) => e.stage === 'retrieving').platform, 'chatgpt');
    assert.equal(events.find((e) => e.stage === 'verifying').messageCount, 7);

    const result = events.at(-1);
    assert.equal(result.type, 'result');
    assert.equal(result.meta.grade, 'verified_with_warnings');
    assert.equal(result.meta.messageCount, 7);
    assert.equal(result.meta.pageCount, 3);
    assert.equal(result.meta.filename, 'chatgpt-Synthetic_fixture_share_payload.pdf');
    assert.ok(result.meta.warnings.length > 0);
    assert.equal(Buffer.from(result.pdf, 'base64').subarray(0, 5).toString(), '%PDF-');
  });
});

test('stream: extraction failure arrives as an error event with its code', async () => {
  const failing = async () => {
    throw new AppError('NOT_FOUND', 'Gone');
  };
  await withServer(app({ extractors: { chatgpt: failing } }), async (base) => {
    const res = await postJson(base, '/api/convert/stream', { url: URL });
    assert.equal(res.status, 200);
    const events = await readEvents(res);
    assert.deepEqual(events.filter((e) => e.type === 'stage').map((e) => e.stage), ['validating', 'retrieving']);
    const last = events.at(-1);
    assert.equal(last.type, 'error');
    assert.equal(last.error.code, 'NOT_FOUND');
    assert.equal(last.error.statusCode, 404);
  });
});

test('stream: unsupported URL is reported as an error event; bad bodies stay plain JSON errors', async () => {
  await withServer(app(), async (base) => {
    const events = await readEvents(await postJson(base, '/api/convert/stream', { url: 'https://evil.example/x' }));
    assert.equal(events.at(-1).error.code, 'UNSUPPORTED_URL');

    const bad = await postJson(base, '/api/convert/stream', '{"url":');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, 'INVALID_REQUEST');
  });
});

test('stream: verification failure blocks the PDF', async () => {
  const broken = async (validation) => {
    const conv = await fixtureExtractor(validation);
    conv.messages[1].structuredBlocks = [{ type: 'paragraph', text: 'truncated' }];
    return conv;
  };
  await withServer(app({ extractors: { chatgpt: broken } }), async (base) => {
    const events = await readEvents(await postJson(base, '/api/convert/stream', { url: URL }));
    assert.equal(events.at(-1).error.code, 'VERIFICATION_FAILED');
    assert.ok(!events.some((e) => e.type === 'result'));
  });
});

test('stream: client cancellation reaches the extractor', async () => {
  const seen = { aborted: false };
  await withServer(app({ extractors: { chatgpt: hangingExtractor(seen) } }), async (base) => {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/convert/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: URL }),
      signal: controller.signal
    });
    const reader = res.body.getReader();
    await reader.read(); // first stage event arrived
    controller.abort();
    for (let i = 0; i < 50 && !seen.aborted; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(seen.aborted, true);
  });
});

test('stream: request timeout is delivered as an error event and stops the work', async () => {
  const previous = process.env.REQUEST_TIMEOUT_MS;
  process.env.REQUEST_TIMEOUT_MS = '300';
  const seen = { aborted: false };
  try {
    await withServer(app({ extractors: { chatgpt: hangingExtractor(seen) } }), async (base) => {
      const events = await readEvents(await postJson(base, '/api/convert/stream', { url: URL }));
      assert.equal(events.at(-1).type, 'error');
      assert.equal(events.at(-1).error.code, 'TIMEOUT');
      assert.equal(seen.aborted, true);
    });
  } finally {
    if (previous === undefined) delete process.env.REQUEST_TIMEOUT_MS;
    else process.env.REQUEST_TIMEOUT_MS = previous;
  }
});

test('browser jobs: aborting closes the browser and frees the slot', { timeout: 60_000 }, async () => {
  const controller = new AbortController();
  const started = Date.now();
  const job = withBrowserPage(
    async (page) => {
      await page.setContent('<p>waiting</p>');
      await page.waitForTimeout(30_000);
    },
    { hostSuffixes: [], signal: controller.signal }
  );
  setTimeout(() => controller.abort(), 1_500);
  await assert.rejects(job, (err) => err.code === 'CANCELLED');
  assert.ok(Date.now() - started < 15_000, 'cancelled promptly');
  assert.equal(getBrowserPoolStats().active, 0);
});
