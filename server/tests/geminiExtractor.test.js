import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeminiHtml } from '../src/extractors/gemini.extractor.js';
import { verifyConversation } from '../src/verification/verification.service.js';
import { NormalizedConversationSchema } from '../src/schemas/conversation.schema.js';
import { fixture } from './helpers.js';

const URL = 'https://gemini.google.com/share/fixture123';

test('Gemini: extracts turns in order with title and roles', () => {
  const result = parseGeminiHtml(fixture('gemini-share.html'), URL);
  assert.equal(result.platform, 'gemini');
  assert.equal(result.conversationId, 'fixture123');
  assert.equal(result.title, 'Synthetic Gemini Fixture');
  assert.deepEqual(result.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(result.extractionStatus, 'complete');
  assert.equal(NormalizedConversationSchema.safeParse(result).success, true);
});

test('Gemini: prompt lines are verbatim, the hidden "You said" label is excluded', () => {
  const prompt = parseGeminiHtml(fixture('gemini-share.html'), URL).messages[0];
  assert.equal(prompt.originalText, 'Explain *sorting* in   two   languages:\n    def keep(): pass\n\nதமிழ் 中文 😀');
  assert.ok(!prompt.originalText.includes('You said'));
  assert.equal(prompt.structuredBlocks[0].preformatted, true);
});

test('Gemini: reply formatting is captured as safe structured blocks', () => {
  const reply = parseGeminiHtml(fixture('gemini-share.html'), URL).messages[1];
  const blocks = reply.structuredBlocks;

  const heading = blocks.find((b) => b.type === 'heading');
  assert.equal(heading.level, 3);
  assert.equal(heading.text, 'Sorting basics');
  assert.ok(heading.runs.some((r) => r.bold && r.text === 'basics'));

  const para = blocks.find((b) => b.type === 'paragraph' && b.text.startsWith('Sorting puts'));
  // HTML whitespace collapsed exactly as a browser renders it
  assert.equal(para.text, 'Sorting puts items in order. It is fundamental and useful; see this article and bad link.');
  const link = para.runs.find((r) => r.text === 'this article');
  assert.equal(link.href, 'https://en.wikipedia.org/wiki/Sorting_algorithm');
  // javascript: link keeps its text but loses the link (merged into plain text)
  assert.ok(para.runs.some((r) => r.text.includes('bad link') && r.href === undefined));
  assert.ok(para.runs.every((r) => !r.href || r.href.startsWith('https://')));

  const bullets = blocks.find((b) => b.type === 'list' && !b.ordered);
  assert.deepEqual(bullets.items, ['Bubble sort: simple', 'Merge sort: fast', 'Nested: stable']);
  assert.deepEqual(bullets.itemDepths, [0, 0, 1]);

  const numbered = blocks.find((b) => b.type === 'list' && b.ordered);
  assert.equal(numbered.start, 3);

  const code = blocks.find((b) => b.type === 'code');
  assert.equal(code.language, 'python');
  assert.equal(code.code, 'def sort(xs):\n    return sorted(xs)  # four-space indent\n');

  const table = blocks.find((b) => b.type === 'table');
  assert.deepEqual(table.headers, ['Algorithm', 'Time']);
  assert.deepEqual(table.rows, [['Merge', 'O(n log n)'], ['Bubble', 'O(n²)']]);
});

test('Gemini: math becomes LaTeX source, images become reported notices, scripts are ignored', () => {
  const result = parseGeminiHtml(fixture('gemini-share.html'), URL);
  const reply = result.messages[1];

  assert.equal(reply.hasMath, true);
  const mathPara = reply.structuredBlocks.find((b) => b.type === 'paragraph' && b.text.startsWith('Inline math'));
  assert.equal(mathPara.text, 'Inline math x^2 here.');

  assert.ok(reply.structuredBlocks.some((b) => b.type === 'omitted' && b.kind === 'image' && b.label === 'Sorting chart'));
  assert.ok(result.verification.unsupportedOmissions.some((o) => o.includes('image')));

  const all = reply.originalText;
  assert.ok(!all.includes('window.injected'), 'script content is not treated as text');
  assert.ok(all.includes('<script>alert(1)</script>'), 'escaped text stays literal text');
});

test('Gemini: structural cross-check passes but the result is labelled unverified', () => {
  const result = parseGeminiHtml(fixture('gemini-share.html'), URL);
  assert.equal(result.verification.verificationMethod, 'dom_structure_crosscheck');
  assert.equal(result.verification.isVerified, false);
  assert.equal(result.verification.sourceMessageCount, 4);
  assert.deepEqual(result.verification.mismatches, []);

  const report = verifyConversation(result);
  assert.equal(report.passed, true);
  assert.equal(report.grade, 'unverified');
});

test('Gemini: a turn without a reply is reported and marked incomplete', () => {
  const html = fixture('gemini-share.html').replace(
    /<response-container>\s*<message-content>\s*<div class="markdown"><p>You're welcome.<\/p><\/div>\s*<\/message-content>\s*<\/response-container>/,
    ''
  );
  const result = parseGeminiHtml(html, URL);
  assert.equal(result.messages.length, 3);
  assert.equal(result.extractionStatus, 'partial');
  assert.ok(result.verification.mismatches.some((m) => m.includes('Turn 2') && m.includes('no reply')));
  assert.equal(verifyConversation(result).grade, 'incomplete');
});

test('Gemini: invalid/deleted share → NOT_FOUND', () => {
  assert.throws(() => parseGeminiHtml(fixture('gemini-invalid.html'), URL), (err) => err.code === 'NOT_FOUND' && err.statusCode === 404);
});

test('Gemini: page without turns → UNRECOGNIZED_FORMAT', () => {
  assert.throws(() => parseGeminiHtml('<html><body><chat-app></chat-app></body></html>', URL), (err) => err.code === 'UNRECOGNIZED_FORMAT');
});

test('Gemini: very long conversations (500 turns) keep order and count', () => {
  const turn = (i) => `<share-turn-viewer><user-query><div class="query-text"><p class="query-text-line">Question ${i}</p></div></user-query>` +
    `<response-container><message-content><div class="markdown"><p>Answer ${i}</p></div></message-content></response-container></share-turn-viewer>`;
  const html = `<share-viewer>${Array.from({ length: 500 }, (_, i) => turn(i)).join('')}</share-viewer>`;
  const result = parseGeminiHtml(html, URL);
  assert.equal(result.messages.length, 1000);
  assert.equal(result.messages[998].originalText, 'Question 499');
  assert.equal(result.messages[999].originalText, 'Answer 499');
  assert.equal(verifyConversation(result).passed, true);
});
