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

  it('notes (but does not penalise) consecutive same-role messages', () => {
    const conv = makeConversation();
    conv.messages[1].role = 'user';
    const report = verifyConversation(conv);
    assert.equal(report.grade, 'verified');
    assert.ok(report.notes.some((n) => n.includes('consecutive messages share a role')));
  });

  it('warns when duplicate consecutive messages are detected and keeps them', () => {
    const conv = makeConversation();
    conv.messages[1] = { ...conv.messages[0], index: 1 };
    const report = verifyConversation(conv);
    assert.ok(report.warnings.some((w) => w.includes('Duplicate')));
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
    assert.ok(report.errors.some((e) => e.includes('status=failed')));
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
    assert.ok(report.notes.some((n) => n.includes('No independent source')));
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
    assert.ok(report.warnings.some((w) => w.includes('mathematical expressions')));
    assert.equal(report.grade, 'verified_with_warnings');
  });

  it('warns when hasCodeBlocks=true but no code block in structuredBlocks', () => {
    const conv = makeConversation();
    conv.messages[0].hasCodeBlocks = true;
    const report = verifyConversation(conv);
    assert.ok(report.warnings.some((w) => w.includes('hasCodeBlocks=true')));
  });

  it('warns on unsupported omissions from extractor', () => {
    const conv = makeConversation();
    conv.verification.unsupportedOmissions = ['2 × image'];
    const report = verifyConversation(conv);
    assert.ok(report.warnings.some((w) => w.includes('Content not reproduced') && w.includes('2 × image')));
  });

  it('surfaces extractor warnings and mismatches', () => {
    const conv = makeConversation({ warnings: ['extractor warning'] });
    conv.verification.mismatches = ['Turn 3: no reply element found.'];
    const report = verifyConversation(conv);
    assert.ok(report.warnings.includes('extractor warning'));
    assert.ok(report.warnings.includes('Turn 3: no reply element found.'));
  });
});
