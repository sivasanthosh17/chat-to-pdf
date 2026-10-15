/**
 * Download options: "show only the first N lines of my messages".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDownloadOptions, userMessageLineCounts, countLines } from '../src/services/downloadOptions.service.js';
import { verifyConversation } from '../src/verification/verification.service.js';
import { renderConversationToPdf } from '../src/pdf/pdf.service.js';
import { extractPdfText } from '../src/pdf/pdfText.js';
import { compactForComparison } from '../src/extractors/shared/textCompare.js';
import { buildTextMessage } from '../src/extractors/shared/messageBuilder.js';
import { makeConversation, withServer, postJson, testApp } from './helpers.js';

const longPrompt = Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of my long prompt`).join('\n');

function conversationWithLongPrompt() {
  const conv = makeConversation();
  conv.messages[0] = buildTextMessage({ index: 0, role: 'user', originalText: longPrompt, plain: true }).message;
  conv.messages[0].structuredBlocks.push({ type: 'omitted', kind: 'attachment', label: 'notes.txt' });
  return conv;
}

test('countLines / userMessageLineCounts report line counts only', () => {
  assert.equal(countLines('a\nb\nc\n'), 3);
  assert.equal(countLines(''), 0);
  assert.deepEqual(userMessageLineCounts(conversationWithLongPrompt()), [12]);
});

test('no option → conversation and report unchanged', () => {
  const conv = conversationWithLongPrompt();
  const report = verifyConversation(conv);
  const out = applyDownloadOptions(conv, report, {});
  assert.equal(out.conversation, conv);
  assert.deepEqual(out.report, { ...report, showSummary: false }, 'summary box is off unless asked for');
  assert.deepEqual(out.applied, { includeVerificationSummary: false });
  assert.equal(applyDownloadOptions(conv, report, { includeVerificationSummary: true }).report.showSummary, true);
});

test('shortens only long user messages, marks the cut, keeps notices and replies', () => {
  const conv = conversationWithLongPrompt();
  const report = verifyConversation(conv);
  const out = applyDownloadOptions(conv, report, { userMessageMaxLines: 5 });

  const [shown, notice, attachment] = out.conversation.messages[0].structuredBlocks;
  assert.equal(shown.text, longPrompt.split('\n').slice(0, 5).join('\n'));
  assert.equal(notice.type, 'omitted');
  assert.equal(notice.kind, 'the rest of this message');
  assert.equal(notice.label, '7 more lines, cut at download');
  assert.equal(attachment.label, 'notes.txt');

  // Source text and the reply are untouched; the original object is not mutated
  assert.equal(out.conversation.messages[0].originalText, longPrompt);
  assert.equal(conv.messages[0].structuredBlocks.length, 2);
  assert.equal(out.conversation.messages[1], conv.messages[1]);

  assert.equal(out.applied.shortenedMessages, 1);
  assert.equal(out.applied.omittedLines, 7);
  assert.equal(
    out.report.adjustments[0],
    'Your messages are cut after 5 lines: 1 message shortened, 7 lines left out. Each cut is marked; replies are complete.'
  );
  assert.equal(out.report.grade, report.grade, 'verification grade is not changed by a presentation choice');
});

test('messages within the limit are left alone', () => {
  const conv = conversationWithLongPrompt();
  const out = applyDownloadOptions(conv, verifyConversation(conv), { userMessageMaxLines: 20 });
  assert.equal(out.applied.shortenedMessages, 0);
  assert.equal(out.conversation, conv);
});

test('PDF: hidden lines are absent, visible lines and the notice are present', { timeout: 120_000 }, async () => {
  const conv = conversationWithLongPrompt();
  const display = applyDownloadOptions(conv, verifyConversation(conv), { userMessageMaxLines: 3, includeVerificationSummary: true });
  const pdf = await renderConversationToPdf(display.conversation, display.report);
  assert.equal(pdf.regressionCheck.passed, true);

  const { pages, visualPages } = await extractPdfText(pdf.buffer);
  const text = compactForComparison(pages.join('') + visualPages.join(''));
  assert.ok(text.includes(compactForComparison('Line 3 of my long prompt')));
  assert.ok(!text.includes(compactForComparison('Line 4 of my long prompt')), 'hidden line must not be in the PDF');
  assert.ok(text.includes(compactForComparison('Not included in this PDF: the rest of this message — 9 more lines, cut at download')));
  assert.ok(text.includes(compactForComparison('Your download choice: Your messages are cut after 3 lines: 1 message shortened, 9 lines left out.')));
});

test('API: options are validated and echoed in the stream result', async () => {
  const extractor = async () => conversationWithLongPrompt();
  const stubPdf = async (conversation, report) => ({
    buffer: Buffer.from('%PDF-1.4\n'),
    regressionCheck: { passed: true, checkedCount: 1, failureCount: 0, failures: [] },
    report,
    pageCount: 1,
    rendered: conversation
  });
  const app = testApp({ renderPdf: stubPdf, extractors: { chatgpt: extractor } });

  await withServer(app, async (base) => {
    const url = 'https://chatgpt.com/share/abc';
    const read = async (body) => (await (await postJson(base, '/api/convert/stream', body)).text()).trim().split('\n').map((l) => JSON.parse(l));

    const full = (await read({ url })).at(-1);
    assert.deepEqual(full.meta.userMessageLineCounts, [12]);
    assert.deepEqual(full.meta.appliedOptions, { includeVerificationSummary: false });
    assert.deepEqual(full.meta.adjustments, []);

    const short = (await read({ url, options: { userMessageMaxLines: 5 } })).at(-1);
    assert.equal(short.meta.appliedOptions.shortenedMessages, 1);
    assert.equal(short.meta.adjustments.length, 1);

    for (const bad of [{ userMessageMaxLines: 0 }, { userMessageMaxLines: 'all' }, { editText: 'x' }]) {
      const res = await postJson(base, '/api/convert/stream', { url, options: bad });
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
  });
});
