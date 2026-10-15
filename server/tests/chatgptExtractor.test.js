import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChatGptHtml,
  parseChatGptSharePayload,
  parseStructuredBlocks,
  classifyChatGptMessage,
  resolveCitations,
  extractChatGptConversation
} from '../src/extractors/chatgpt.extractor.js';
import { NormalizedConversationSchema } from '../src/schemas/conversation.schema.js';
import { verifyConversation } from '../src/verification/verification.service.js';
import { fixture, jsonFixture } from './helpers.js';

const SHARE_URL = 'https://chatgpt.com/share/fixture-conversation';

// ── Share payload (current format) ───────────────────────────────────────────

test('ChatGPT payload: keeps only messages the share page displays, in order', () => {
  const result = parseChatGptSharePayload(jsonFixture('chatgpt-share-payload.json'), SHARE_URL);

  assert.deepEqual(result.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user', 'user', 'assistant']);
  assert.deepEqual(result.messages.map((m) => m.index), [0, 1, 2, 3, 4, 5, 6]);

  const all = result.messages.map((m) => m.originalText).join('\n');
  assert.ok(!all.includes('You are ChatGPT'), 'hidden system message excluded');
  assert.ok(!all.includes('OLD BRANCH'), 'inactive branch excluded');
  assert.ok(!all.includes('search_query'), 'tool call excluded');
  assert.ok(!all.includes('search results'), 'tool output excluded');
});

test('ChatGPT payload: user text is preserved byte-for-byte, including whitespace and Unicode', () => {
  const payload = jsonFixture('chatgpt-share-payload.json');
  const result = parseChatGptSharePayload(payload, SHARE_URL);
  const expected = payload.mapping.u1.message.content.parts[0];

  assert.equal(result.messages[0].originalText, expected);
  assert.ok(expected.includes('    indented line keeps 4 spaces'));
  assert.ok(expected.includes('தமிழ் · 中文 · العربية · 😀'));
  // Prompts are plain text on ChatGPT: no markdown interpretation
  assert.deepEqual(result.messages[0].structuredBlocks, [{ type: 'paragraph', text: expected, preformatted: true }]);
});

test('ChatGPT payload: verified exactly against the independent linear_conversation list', () => {
  const result = parseChatGptSharePayload(jsonFixture('chatgpt-share-payload.json'), SHARE_URL);
  assert.equal(result.verification.verificationMethod, 'independent_source_match');
  assert.equal(result.verification.isVerified, true);
  assert.equal(result.verification.exactTextMatch, true);
  assert.equal(result.verification.sourceMessageCount, 7);
  assert.equal(result.verification.extractedMessageCount, 7);
  assert.deepEqual(result.verification.mismatches, []);
  assert.equal(result.extractionStatus, 'complete');
});

test('ChatGPT payload: a mismatch with linear_conversation is detected and reported', () => {
  const payload = jsonFixture('chatgpt-share-payload.json');
  const item = payload.linear_conversation.find((i) => i.id === 'a2');
  item.message.content.parts[0] = 'Something else entirely';

  const result = parseChatGptSharePayload(payload, SHARE_URL);
  assert.equal(result.verification.isVerified, false);
  assert.equal(result.extractionStatus, 'partial');
  assert.ok(result.verification.mismatches.includes("Message 4 does not match ChatGPT's second copy of it word for word."));

  const report = verifyConversation(result);
  assert.equal(report.grade, 'incomplete');
});

test('ChatGPT payload: a message missing from linear_conversation is detected', () => {
  const payload = jsonFixture('chatgpt-share-payload.json');
  payload.linear_conversation = payload.linear_conversation.filter((i) => i.id !== 'a3');
  const result = parseChatGptSharePayload(payload, SHARE_URL);
  assert.ok(result.verification.mismatches.some((m) => m.includes('Some messages may be missing')));
  assert.equal(result.extractionStatus, 'partial');
});

test('ChatGPT payload: without linear_conversation the result is honestly unverified', () => {
  const payload = jsonFixture('chatgpt-share-payload.json');
  delete payload.linear_conversation;
  const result = parseChatGptSharePayload(payload, SHARE_URL);
  assert.equal(result.verification.isVerified, false);
  assert.equal(result.verification.verificationMethod, 'unverified');
  assert.equal(verifyConversation(result).grade, 'unverified');
});

test('ChatGPT payload: tool activity, reasoning, images and attachments are reported, never silently dropped', () => {
  const result = parseChatGptSharePayload(jsonFixture('chatgpt-share-payload.json'), SHARE_URL);
  const omissions = result.verification.unsupportedOmissions.join(' | ');
  assert.match(omissions, /1 tool call/);
  assert.match(omissions, /1 tool output/);
  assert.match(omissions, /1 reasoning step/);
  assert.match(omissions, /1 image/);
  assert.match(omissions, /1 attachment/);

  // Tool activity is marked in place before the reply it belongs to
  const reply = result.messages[1];
  assert.equal(reply.structuredBlocks[0].type, 'omitted');
  assert.match(reply.structuredBlocks[0].label, /tool call.*tool output.*reasoning/);

  // Image + attachment notices sit inside the user message that contained them
  const kinds = result.messages[2].structuredBlocks.filter((b) => b.type === 'omitted').map((b) => b.kind);
  assert.deepEqual(kinds, ['image', 'attachment']);
  assert.equal(result.messages[2].originalText, 'What is in this image?');
});

test('ChatGPT payload: citation markers are resolved to the label ChatGPT displays; originalText stays verbatim', () => {
  const result = parseChatGptSharePayload(jsonFixture('chatgpt-share-payload.json'), SHARE_URL);
  const reply = result.messages[1];
  assert.ok(reply.originalText.includes('\ue200cite\ue202turn0search0\ue201'), 'source text untouched');
  assert.ok(reply.displayText.includes('([Example](https://example.com/source))'));
  assert.ok(!/[\ue200-\ue2ff]/.test(reply.displayText));
});

test('ChatGPT payload: markdown structure — numbered heading, list start, code indentation, escaped table pipe', () => {
  const reply = parseChatGptSharePayload(jsonFixture('chatgpt-share-payload.json'), SHARE_URL).messages[1];
  const blocks = reply.structuredBlocks;

  const heading = blocks.find((b) => b.type === 'heading');
  assert.equal(heading.text, '2. Steps');

  const list = blocks.find((b) => b.type === 'list' && b.ordered);
  assert.equal(list.start, 3);
  assert.deepEqual(list.items, ['Third step first', 'Fourth step']);

  const code = blocks.find((b) => b.type === 'code');
  assert.equal(code.language, 'python');
  assert.equal(code.code, 'def f(x):\n    if x:\n        return x * 2  # keep indentation\n');

  const table = blocks.find((b) => b.type === 'table');
  assert.deepEqual(table.headers, ['Name', 'Value']);
  assert.deepEqual(table.rows, [['a', '1'], ['b \\| c', '2']]);

  assert.equal(reply.hasMath, true);
  assert.equal(reply.hasTables, true);
});

test('ChatGPT payload: duplicate consecutive messages are preserved and flagged', () => {
  const result = parseChatGptSharePayload(jsonFixture('chatgpt-share-payload.json'), SHARE_URL);
  assert.equal(result.messages[4].originalText, 'Same question');
  assert.equal(result.messages[5].originalText, 'Same question');
  const report = verifyConversation(result);
  assert.ok(report.warnings.includes('Duplicate: messages 5 and 6 are identical. Both are kept, as in the original.'));
  assert.equal(report.passed, true);
});

test('classifyChatGptMessage follows the share page display rules', () => {
  const base = { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['x'] }, recipient: 'all', metadata: {} };
  assert.deepEqual(classifyChatGptMessage(base), { kind: 'message', role: 'assistant' });
  assert.equal(classifyChatGptMessage({ ...base, recipient: 'python' }).kind, 'omit');
  assert.equal(classifyChatGptMessage({ ...base, author: { role: 'tool' } }).kind, 'omit');
  assert.equal(classifyChatGptMessage({ ...base, metadata: { is_visually_hidden_from_conversation: true } }).kind, 'skip');
  assert.equal(classifyChatGptMessage({ ...base, content: { content_type: 'model_editable_context' } }).kind, 'skip');
  assert.equal(classifyChatGptMessage({ ...base, content: { content_type: 'reasoning_recap', content: '' } }).label, 'reasoning');
  assert.equal(classifyChatGptMessage(null).kind, 'skip');
});

test('resolveCitations removes markers that have no label and counts them', () => {
  const r = resolveCitations('A \ue200cite\ue202x\ue201 B', []);
  assert.equal(r.displayText, 'A  B');
  assert.equal(r.unresolved, 1);
});

// ── Legacy HTML formats ──────────────────────────────────────────────────────

test('ChatGPT legacy __NEXT_DATA__ page: extracted verbatim but labelled unverified (no independent copy)', () => {
  const result = parseChatGptHtml(fixture('chatgpt-nextdata.html'), 'https://chatgpt.com/share/test-nextdata-123');

  assert.equal(result.platform, 'chatgpt');
  assert.equal(result.conversationId, 'test-nextdata-123');
  assert.equal(result.title, 'Understanding Neural Network Backpropagation');
  assert.deepEqual(result.messages.map((m) => m.role), ['user', 'assistant', 'user']);

  const code = result.messages[1].structuredBlocks.find((b) => b.type === 'code');
  assert.equal(code.language, 'python');
  assert.ok(code.code.includes('    z1 = np.dot(w1, x)'));

  assert.equal(result.verification.isVerified, false);
  assert.equal(result.verification.verificationMethod, 'unverified');
  assert.equal(NormalizedConversationSchema.safeParse(result).success, true);
});

test('ChatGPT rendered DOM: tables and code extracted, labelled as DOM-only (unverified)', () => {
  const result = parseChatGptHtml(fixture('chatgpt-dom.html'), 'https://chat.openai.com/share/test-dom-456');

  assert.equal(result.conversationId, 'test-dom-456');
  assert.equal(result.title, 'Sorting Algorithms Comparison');
  assert.equal(result.messages.length, 2);

  const assistant = result.messages[1];
  const table = assistant.structuredBlocks.find((b) => b.type === 'table');
  assert.deepEqual(table.headers, ['Algorithm', 'Average Time', 'Worst Time', 'Space Complexity']);
  assert.equal(table.rows[0][0], 'QuickSort');
  const code = assistant.structuredBlocks.find((b) => b.type === 'code');
  assert.equal(code.language, 'python');
  assert.ok(code.code.includes('def quicksort(arr):'));

  assert.equal(result.verification.verificationMethod, 'dom_structure_crosscheck');
  assert.equal(result.verification.isVerified, false);
  assert.equal(verifyConversation(result).passed, true);
});

test('ChatGPT HTML without conversation content is rejected with UNRECOGNIZED_FORMAT', () => {
  assert.throws(
    () => parseChatGptHtml('<html><head><title>Empty</title></head><body><div>No content</div></body></html>', 'https://chatgpt.com/share/empty-123'),
    (err) => err.code === 'UNRECOGNIZED_FORMAT'
  );
});

test('parseStructuredBlocks helper extracts code blocks with exact whitespace', () => {
  const blocks = parseStructuredBlocks("Here is Python:\n```python\nfor i in range(10):\n    print(i)\n```\nDone.");
  assert.equal(blocks.length, 3);
  assert.equal(blocks[1].type, 'code');
  assert.equal(blocks[1].language, 'python');
  assert.equal(blocks[1].code, 'for i in range(10):\n    print(i)\n');
  assert.equal(blocks[2].text, 'Done.');
});

// ── Live retrieval error mapping (network mocked) ───────────────────────────

function fakeFetch(status, body, headers = {}) {
  return async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

const validation = { platform: 'chatgpt', platformName: 'ChatGPT', shareId: 'abc-123', canonicalUrl: 'https://chatgpt.com/share/abc-123' };
const offline = (fetchImpl) => ({ allowBrowserFallback: false, fetchOptions: { fetchImpl, skipDns: true } });

test('ChatGPT live: payload response is parsed and verified', async () => {
  const result = await extractChatGptConversation(validation, offline(fakeFetch(200, jsonFixture('chatgpt-share-payload.json'))));
  assert.equal(result.messages.length, 7);
  assert.equal(result.verification.isVerified, true);
});

test('ChatGPT live: 404 not_found → NOT_FOUND (private or deleted share)', async () => {
  await assert.rejects(
    extractChatGptConversation(validation, offline(fakeFetch(404, { detail: { reason: 'not_found' } }))),
    (err) => err.code === 'NOT_FOUND' && err.statusCode === 404
  );
});

test('ChatGPT live: "Can\'t load shared conversation" 500 → NOT_FOUND', async () => {
  await assert.rejects(
    extractChatGptConversation(validation, offline(fakeFetch(500, { detail: { description: "Can't load shared conversation x", reason: 'unknown' } }))),
    (err) => err.code === 'NOT_FOUND'
  );
});

test('ChatGPT live: Cloudflare challenge → ACCESS_BLOCKED (no bypass attempted)', async () => {
  await assert.rejects(
    extractChatGptConversation(validation, offline(fakeFetch(403, '<html>Just a moment...</html>', { 'cf-mitigated': 'challenge', 'content-type': 'text/html' }))),
    (err) => err.code === 'ACCESS_BLOCKED' && err.statusCode === 403
  );
});

test('ChatGPT live: 503 / 429 → retryable UPSTREAM_ERROR', async () => {
  for (const status of [503, 429]) {
    await assert.rejects(
      extractChatGptConversation(validation, offline(fakeFetch(status, { detail: 'busy' }))),
      (err) => err.code === 'UPSTREAM_ERROR' && err.retryable === true
    );
  }
});

test('ChatGPT live: network failure → UPSTREAM_ERROR; timeout → TIMEOUT', async () => {
  const failing = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(extractChatGptConversation(validation, offline(failing)), (err) => err.code === 'UPSTREAM_ERROR');

  // AbortSignal.timeout() timers do not keep the event loop alive on their own
  const hanging = (url, { signal }) => new Promise((_, reject) => {
    const keepAlive = setTimeout(() => {}, 5_000);
    signal.addEventListener('abort', () => {
      clearTimeout(keepAlive);
      reject(signal.reason);
    });
  });
  await assert.rejects(
    extractChatGptConversation(validation, { allowBrowserFallback: false, fetchOptions: { fetchImpl: hanging, skipDns: true, timeoutMs: 50 } }),
    (err) => err.code === 'TIMEOUT' && err.statusCode === 504
  );
});

test('ChatGPT live: malformed JSON → UNRECOGNIZED_FORMAT', async () => {
  await assert.rejects(
    extractChatGptConversation(validation, offline(fakeFetch(200, 'not json', { 'content-type': 'text/plain' }))),
    (err) => err.code === 'UNRECOGNIZED_FORMAT'
  );
});
