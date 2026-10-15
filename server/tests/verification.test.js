/**
 * verification.test.js
 *
 * Tests for the verification service. Uses synthetic NormalizedConversation
 * fixtures to test each check in isolation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyConversation, compareMessageBlocks } from '../src/verification/verification.service.js';
import { makeConversation } from './helpers.js';

describe('verifyConversation', () => {
  it('grades a clean, independently verified conversation as verified', () => {
    const report = verifyConversation(makeConversation());
    assert.equal(report.passed, true);
    assert.equal(report.grade, 'verified');
    assert.equal(report.errors.length, 0);
  });

  it('errors when message array length mismatches extractedMessageCount', () => {
    const conv = makeConversation();
    conv.verification.extractedMessageCount = 99;
    const report = verifyConversation(conv);
    assert.equal(report.passed, false);
    assert.equal(report.grade, 'failed');
    assert.ok(report.errors.some((e) => e.includes('mismatch')));
  });

  it('errors when the source count differs but the extractor claimed completeness', () => {
    const conv = makeConversation();
    conv.verification.sourceMessageCount = 3;
    const report = verifyConversation(conv);
    assert.equal(report.passed, false);
    assert.ok(report.errors.some((e) => e.includes('Source reports 3 messages')));
  });

  it('accepts a source/extracted count difference when extraction is marked partial → incomplete', () => {
    const conv = makeConversation({ extractionStatus: 'partial' });
    conv.verification.sourceMessageCount = 3;
    const report = verifyConversation(conv);
    assert.equal(report.passed, true);
    assert.equal(report.grade, 'incomplete');
  });

  it('errors on empty message array', () => {
    const conv = makeConversation({ messages: [] });
    conv.verification.extractedMessageCount = 0;
    conv.verification.sourceMessageCount = 0;
    const report = verifyConversation(conv);
    assert.equal(report.passed, false);
    assert.ok(report.errors.some((e) => e.includes('zero messages')));
  });

  it('errors when message index continuity is broken', () => {
    const conv = makeConversation();
    conv.messages[1].index = 99;
    const report = verifyConversation(conv);
    assert.equal(report.passed, false);
    assert.ok(report.errors.some((e) => e.includes('index=')));
  });

  it('records (but does not penalise or print) consecutive same-role messages', () => {
    const conv = makeConversation();
    conv.messages[1].role = 'user';
    const report = verifyConversation(conv);
    assert.equal(report.grade, 'verified');
    assert.equal(report.checks.roleSequence.consecutive, 1);
    assert.deepEqual(report.notes, []);
  });

  it('warns when duplicate consecutive messages are detected and keeps them', () => {
    const conv = makeConversation();
    conv.messages[1] = { ...conv.messages[0], index: 1 };
    const report = verifyConversation(conv);
    assert.ok(report.warnings.includes('Duplicate: messages 1 and 2 are identical. Both are kept, as in the original.'));
    assert.equal(report.passed, true);
  });

  it('blocks the PDF when structured blocks lose content', () => {
    const conv = makeConversation();
    conv.messages[1].structuredBlocks = [{ type: 'paragraph', text: 'I am doing well' }];
    const report = verifyConversation(conv);
    assert.equal(report.passed, false);
    assert.equal(report.checks.blockFidelity.failures[0].index, 1);
  });

  it('accepts markdown blocks whose only difference is consumed block syntax', () => {
    const text = '## Title\n\n- one\n- two\n\n```js\n  x\n```';
    const result = compareMessageBlocks({
      originalText: text,
      structuredBlocks: [
        { type: 'heading', level: 2, text: 'Title' },
        { type: 'list', ordered: false, items: ['one', 'two'] },
        { type: 'code', language: 'js', code: '  x\n' }
      ]
    });
    assert.equal(result.match, true);
    assert.equal(result.mode, 'markdown');
  });

  it('errors when extractionStatus is failed', () => {
    const report = verifyConversation(makeConversation({ extractionStatus: 'failed' }));
    assert.equal(report.passed, false);
    assert.ok(report.errors.includes('The conversation could not be read, so no PDF was made.'));
  });

  it('grades partial extraction as incomplete (PDF allowed with banner)', () => {
    const report = verifyConversation(makeConversation({ extractionStatus: 'partial' }));
    assert.equal(report.passed, true);
    assert.equal(report.grade, 'incomplete');
  });

  it('grades conversations without an independent source as unverified', () => {
    const conv = makeConversation();
    conv.verification.isVerified = false;
    conv.verification.verificationMethod = 'dom_structure_crosscheck';
    const report = verifyConversation(conv);
    assert.equal(report.passed, true);
    assert.equal(report.grade, 'unverified');
    assert.deepEqual(report.notes, [], 'the reason is stated once, by the grade text in the PDF/UI');
  });

  it('does not accept isVerified=true without a source-match method', () => {
    const conv = makeConversation();
    conv.verification.verificationMethod = 'unverified';
    assert.equal(verifyConversation(conv).grade, 'unverified');
  });

  it('warns on math-containing messages', () => {
    const conv = makeConversation();
    conv.messages[0].hasMath = true;
    const report = verifyConversation(conv);
    assert.ok(report.warnings.includes('Message 1 contains maths, shown as LaTeX source rather than typeset formulas.'));
    assert.equal(report.grade, 'verified_with_warnings');
  });

  it('warns when hasCodeBlocks=true but no code block in structuredBlocks', () => {
    const conv = makeConversation();
    conv.messages[0].hasCodeBlocks = true;
    const report = verifyConversation(conv);
    assert.ok(report.warnings.includes('The code in message 1 is shown as plain text, so its indentation may not be preserved.'));
  });

  it('warns on unsupported omissions from extractor', () => {
    const conv = makeConversation();
    conv.verification.unsupportedOmissions = ['2 images', '1 attachment', '4 tool outputs'];
    const report = verifyConversation(conv);
    assert.ok(report.warnings.includes('Not included in this PDF (each is marked where it occurred): 2 images, 1 attachment and 4 tool outputs.'));
  });

  it('surfaces extractor warnings and mismatches', () => {
    const conv = makeConversation({ warnings: ['extractor warning'] });
    conv.verification.mismatches = ['Turn 3: no reply element found.'];
    const report = verifyConversation(conv);
    assert.ok(report.warnings.includes('extractor warning'));
    assert.ok(report.warnings.includes('Turn 3: no reply element found.'));
  });
});
