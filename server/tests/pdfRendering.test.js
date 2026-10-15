/**
 * PDF rendering tests (real Playwright + Chromium).
 *
 * The generated PDF's text layer is read back with PDF.js and compared with
 * the known source fixtures. Comparisons are whitespace-insensitive (PDF
 * layout re-flows lines) but otherwise character-exact.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderConversationToPdf } from '../src/pdf/pdf.service.js';
import { extractPdfText, compareSegmentsToPdf } from '../src/pdf/pdfText.js';
import { verifyConversation } from '../src/verification/verification.service.js';
import { parseChatGptSharePayload } from '../src/extractors/chatgpt.extractor.js';
import { parseGeminiHtml } from '../src/extractors/gemini.extractor.js';
import { parseClaudeSnapshot } from '../src/extractors/claude.extractor.js';
import { buildTextMessage } from '../src/extractors/shared/messageBuilder.js';
import { compactForComparison } from '../src/extractors/shared/textCompare.js';
import { fixture, jsonFixture, makeConversation } from './helpers.js';

async function renderAndRead(conversation) {
  const report = verifyConversation(conversation);
  assert.equal(report.passed, true, `verification must pass: ${report.errors.join('; ')}`);
  // Include the optional summary box so its wording is covered too
  const result = await renderConversationToPdf(conversation, { ...report, showSummary: true });
  const text = await extractPdfText(result.buffer);
  const compact = compactForComparison(text.pages.join('\n') + '\n' + text.visualPages.join('\n'));
  return { result, text, compact };
}

const contains = (compact, s) => compact.includes(compactForComparison(s));
const occurrences = (compact, s) => compact.split(compactForComparison(s)).length - 1;

test('PDF (ChatGPT fixture): every message is present in the PDF text layer', { timeout: 120_000 }, async () => {
  const conv = parseChatGptSharePayload(jsonFixture('chatgpt-share-payload.json'), 'https://chatgpt.com/share/fixture-conversation');
  const { result, compact } = await renderAndRead(conv);

  assert.equal(result.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.equal(result.regressionCheck.passed, true, JSON.stringify(result.regressionCheck));
  assert.ok(result.regressionCheck.checkedCount >= 10);

  // User prompt: verbatim, including markdown-looking characters
  assert.ok(contains(compact, 'Explain   this *literally*:'));
  assert.ok(contains(compact, 'indented line keeps 4 spaces'));
  // Code block content
  assert.ok(contains(compact, 'return x * 2  # keep indentation'));
  // Table cells (escaped pipe kept as written)
  assert.ok(contains(compact, 'b \\| c'));
  // Citation label as ChatGPT displays it; the private-use marker is gone
  assert.ok(contains(compact, 'Example'));
  assert.ok(!/[-]/.test(compact));
  // HTML in text is printed literally
  assert.ok(contains(compact, 'Final answer with <script>alert(1)</script> shown as text.'));
  // Duplicates preserved (compact text holds both stream and visual views, so each copy is counted twice)
  assert.equal(occurrences(compact, 'Same question'), 4);
  // Hidden / inactive content never appears
  assert.ok(!contains(compact, 'OLD BRANCH SHOULD NOT APPEAR'));
  assert.ok(!contains(compact, 'You are ChatGPT'));
  // Omissions are visible in place
  assert.ok(contains(compact, 'Not included in this PDF'));
  // Verification banner reflects the grade
  assert.ok(contains(compact, 'Content verification: Verified with warnings'));
});

test('PDF (Gemini fixture): Unicode, lists, code and tables survive; labelled unverified', { timeout: 120_000 }, async () => {
  const conv = parseGeminiHtml(fixture('gemini-share.html'), 'https://gemini.google.com/share/fixture123');
  const { result, compact } = await renderAndRead(conv);

  assert.equal(result.report.grade, 'unverified');
  assert.equal(result.regressionCheck.passed, true, JSON.stringify(result.regressionCheck));
  assert.ok(contains(compact, '中文'));
  assert.ok(contains(compact, 'O(n²)'));
  assert.ok(contains(compact, 'def sort(xs):'));
  assert.ok(contains(compact, 'Merge sort: fast'));
  assert.ok(contains(compact, 'Inline math x^2 here.'));
  assert.ok(contains(compact, 'Content verification: Unverified'));
});

test('PDF (Claude fixture): renders with tool-use notice and unverified label', { timeout: 120_000 }, async () => {
  const conv = parseClaudeSnapshot(jsonFixture('claude-snapshot.json'), 'https://claude.ai/share/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  const { result, compact } = await renderAndRead(conv);
  assert.equal(result.regressionCheck.passed, true, JSON.stringify(result.regressionCheck));
  assert.ok(contains(compact, 'A frog jumps into the pond'));
  assert.ok(contains(compact, '1 tool use and 1 tool result'));
  assert.ok(contains(compact, 'ありがとう'));
});

test('PDF: very long conversation (300 messages, code in every reply) renders completely', { timeout: 180_000 }, async () => {
  const messages = [];
  for (let i = 0; i < 300; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const text = role === 'user'
      ? `Question number ${i}: ${'lorem ipsum '.repeat(20)}`
      : `Answer ${i}\n\n\`\`\`js\nfunction f${i}() {\n    return ${i};\n}\n\`\`\`\n\n- point ${i}a\n- point ${i}b`;
    messages.push(buildTextMessage({ index: i, role, originalText: text, plain: role === 'user' }).message);
  }
  const conv = makeConversation({ messages });
  conv.verification.sourceMessageCount = conv.verification.extractedMessageCount = 300;

  const started = Date.now();
  const { result, compact } = await renderAndRead(conv);
  assert.equal(result.regressionCheck.passed, true, JSON.stringify(result.regressionCheck));
  assert.ok(result.pageCount > 20, `expected many pages, got ${result.pageCount}`);
  for (const i of [0, 149, 299]) {
    assert.ok(contains(compact, i % 2 === 0 ? `Question number ${i}:` : `return ${i};`), `message ${i}`);
  }
  assert.ok(Date.now() - started < 120_000);
});

test('PDF: malicious markup in content is printed as text and cannot reach the network', { timeout: 120_000 }, async () => {
  const payload = '</p></div><img src="https://attacker.example/track.png" onerror="alert(1)"><style>body{display:none}</style><a href="javascript:alert(1)">x</a>';
  const conv = makeConversation();
  conv.messages[1] = buildTextMessage({ index: 1, role: 'assistant', originalText: payload }).message;
  const { result, compact } = await renderAndRead(conv);
  assert.equal(result.regressionCheck.passed, true);
  assert.ok(contains(compact, '<img src="https://attacker.example/track.png" onerror="alert(1)">'));
  assert.ok(contains(compact, '<style>body{display:none}</style>'));
});

test('compareSegmentsToPdf: accepts right-to-left text stored in visual order', () => {
  const segments = [{ messageIndex: 0, text: 'Hello العربية world' }];
  assert.equal(compareSegmentsToPdf(segments, { pages: ['Hello ةيبرعلا world'] }).passed, true);
  assert.equal(compareSegmentsToPdf(segments, { pages: ['Hello world'] }).passed, false);
});

test('compareSegmentsToPdf: detects missing text', () => {
  const segments = [{ messageIndex: 0, text: 'Hello world' }, { messageIndex: 1, text: 'Second message' }];
  assert.equal(compareSegmentsToPdf(segments, { pages: ['Hello   world\nSecond message'] }).passed, true);
  const missing = compareSegmentsToPdf(segments, { pages: ['Hello world'] });
  assert.equal(missing.passed, false);
  assert.deepEqual(missing.failures, [{ messageIndex: 1, length: 13 }]);
});
