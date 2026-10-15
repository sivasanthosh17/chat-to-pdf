/**
 * verification.service.js
 *
 * Verifies a NormalizedConversation before PDF generation and decides whether
 * a PDF may be produced and how it must be labelled.
 *
 * Verification philosophy:
 *   - We never compare the extracted data only against itself. Source-level
 *     verification is done by the extractor against an independent copy in
 *     the platform data (e.g. ChatGPT's linear_conversation list) and reported
 *     in `conversation.verification`; this service checks that report and
 *     refuses to call a conversion "verified" without it.
 *   - The checks here verify the *transformation* steps: the structured
 *     blocks that are laid out in the PDF must reproduce every character of
 *     each message (whitespace-insensitive), indices must be continuous,
 *     counts must agree with the source.
 *   - Anything that cannot be checked is reported as a limitation.
 *
 * Grades (most severe first):
 *   failed                 – a fatal check failed → no PDF
 *   incomplete             – extractor reported partial extraction → PDF with INCOMPLETE banner
 *   unverified             – no independent source was available → PDF labelled unverified
 *   verified_with_warnings – verified against the source, with warnings
 *   verified               – verified, no warnings
 */

import { markdownToComparableText } from '../extractors/shared/markdown.js';
import { blocksToPlainText, compareCompact } from '../extractors/shared/textCompare.js';
import { joinList, messageList } from '../utils/wording.js';

export const GRADES = ['verified', 'verified_with_warnings', 'unverified', 'incomplete', 'failed'];

/**
 * @typedef {object} VerificationReport
 * @property {boolean}  passed    - false → PDF generation is blocked
 * @property {string}   grade     - one of GRADES
 * @property {string[]} warnings  - non-fatal issues found
 * @property {string[]} errors    - fatal issues that block PDF generation
 * @property {string[]} notes     - informational statements (method, limitations)
 * @property {object}   checks    - detailed per-check results
 */

/**
 * Runs all verification checks against a normalized conversation.
 *
 * @param {object} conversation - NormalizedConversation
 * @returns {VerificationReport}
 */
export function verifyConversation(conversation) {
  const warnings = [];
  const errors = [];
  const notes = [];
  const checks = {};

  checks.messageCount = checkMessageCount(conversation, warnings, errors);
  checks.indexContinuity = checkIndexContinuity(conversation, errors);
  checks.roleSequence = checkRoleSequence(conversation);
  checks.blockFidelity = checkBlockFidelity(conversation, errors);
  checks.formatFlags = checkFormatFlags(conversation, warnings);
  checks.duplicateDetection = checkDuplicates(conversation, warnings);
  checks.omissionCheck = checkUnsupportedOmissions(conversation, warnings);
  checks.extractionStatus = checkExtractionStatus(conversation, errors);
  checks.sourceVerification = checkSourceVerification(conversation, warnings, notes);

  for (const w of conversation.warnings || []) warnings.push(w);

  const passed = errors.length === 0;
  let grade;
  if (!passed) grade = 'failed';
  else if (conversation.extractionStatus === 'partial') grade = 'incomplete';
  else if (!checks.sourceVerification.verified) grade = 'unverified';
  else if (warnings.length > 0) grade = 'verified_with_warnings';
  else grade = 'verified';

  return { passed, grade, warnings, errors, notes, checks };
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual check implementations
// ─────────────────────────────────────────────────────────────────────────────

function checkMessageCount(conv, warnings, errors) {
  const { messages, verification } = conv;
  const extracted = messages.length;
  const claimed = verification.extractedMessageCount;
  const source = verification.sourceMessageCount;

  if (extracted === 0) {
    errors.push('Conversation contains zero messages — nothing to verify.');
    return { passed: false, extracted, claimed, source };
  }

  if (extracted !== claimed) {
    errors.push(`Message count mismatch: schema claims ${claimed} messages but array contains ${extracted}.`);
    return { passed: false, extracted, claimed, source };
  }

  if (source !== extracted) {
    const msg = `Source reports ${source} messages but ${extracted} were extracted.`;
    if (conv.extractionStatus === 'partial') {
      warnings.push(msg);
    } else {
      errors.push(`${msg} The extractor marked the result complete, which is inconsistent.`);
      return { passed: false, extracted, claimed, source };
    }
  }

  return { passed: true, extracted, claimed, source };
}

function checkIndexContinuity(conv, errors) {
  const issues = [];
  conv.messages.forEach((msg, arrayPos) => {
    if (msg.index !== arrayPos) {
      issues.push(`Message at array position ${arrayPos} has index=${msg.index} (expected ${arrayPos}).`);
    }
  });

  if (issues.length > 0) {
    errors.push(...issues);
    return { passed: false, issues };
  }
  return { passed: true, issues: [] };
}

function checkRoleSequence(conv) {
  // Consecutive messages with the same role are legitimate (an assistant reply
  // split around tool use, a prompt sent twice). Recorded for diagnostics only;
  // it is not something a PDF reader needs to be told.
  let consecutive = 0;
  for (let i = 1; i < conv.messages.length; i++) {
    if (conv.messages[i].role === conv.messages[i - 1].role) consecutive++;
  }
  return { passed: true, consecutive };
}

/**
 * Determines what text the structured blocks must reproduce for a message
 * and compares the two in whitespace-insensitive form.
 */
export function compareMessageBlocks(msg) {
  const contentBlocks = (msg.structuredBlocks || []).filter((b) => b.type !== 'omitted');
  const sourceText = msg.displayText ?? msg.originalText;

  if (contentBlocks.length === 0) {
    return { match: sourceText.trim() === '', mode: 'empty', firstDifferenceAt: 0 };
  }

  const fromDom = contentBlocks.some((b) => b.runs || b.itemRuns);
  const allPreformatted = contentBlocks.every((b) => b.type === 'paragraph' && b.preformatted);
  const expected = fromDom || allPreformatted ? sourceText : markdownToComparableText(sourceText);
  const cmp = compareCompact(expected, blocksToPlainText(contentBlocks));
  return { ...cmp, mode: fromDom ? 'dom' : allPreformatted ? 'plain' : 'markdown' };
}

function checkBlockFidelity(conv, errors) {
  const totalLength = conv.messages.reduce((acc, m) => acc + (m.originalText?.length ?? 0), 0);
  const hasOmittedOnly = conv.messages.every((m) => !m.originalText) &&
    conv.messages.some((m) => m.structuredBlocks?.some((b) => b.type === 'omitted'));

  if (totalLength === 0 && !hasOmittedOnly) {
    errors.push('Every message came out empty, so there is nothing to put in a PDF.');
    return { passed: false, totalLength, failures: [] };
  }

  const failures = [];
  conv.messages.forEach((msg, i) => {
    const result = compareMessageBlocks(msg);
    if (!result.match) {
      failures.push({ index: i, mode: result.mode, firstDifferenceAt: result.firstDifferenceAt });
    }
  });

  if (failures.length > 0) {
    errors.push(
      `The formatted version of ${messageList(failures.map((f) => f.index + 1))} does not match the original text exactly, so no PDF was made rather than risk losing words.`
    );
    return { passed: false, totalLength, failures };
  }

  return { passed: true, totalLength, failures: [] };
}

function checkFormatFlags(conv, warnings) {
  const issues = [];
  conv.messages.forEach((msg, i) => {
    if (msg.hasCodeBlocks && !msg.structuredBlocks?.some((b) => b.type === 'code')) {
      issues.push(`The code in message ${i + 1} is shown as plain text, so its indentation may not be preserved.`);
    }
    if (msg.hasTables && !msg.structuredBlocks?.some((b) => b.type === 'table')) {
      issues.push(`The table in message ${i + 1} is shown as plain text.`);
    }
  });

  if (issues.length > 0) {
    warnings.push(...issues);
    return { passed: false, issues };
  }
  return { passed: true, issues: [] };
}

function checkDuplicates(conv, warnings) {
  // Duplicates are preserved per the content-fidelity policy; they are only flagged.
  const duplicates = [];
  for (let i = 1; i < conv.messages.length; i++) {
    const a = conv.messages[i - 1];
    const b = conv.messages[i];
    if (b.originalText && b.originalText === a.originalText && b.role === a.role) {
      duplicates.push(`${i} and ${i + 1}`);
    }
  }

  if (duplicates.length > 0) {
    warnings.push(
      duplicates.length === 1
        ? `Duplicate: messages ${duplicates[0]} are identical. Both are kept, as in the original.`
        : `Duplicates: messages ${joinList(duplicates)} are identical pairs. All are kept, as in the original.`
    );
    return { passed: false, duplicates };
  }
  return { passed: true, duplicates: [] };
}

function checkUnsupportedOmissions(conv, warnings) {
  const omissions = conv.verification?.unsupportedOmissions ?? [];
  if (omissions.length > 0) {
    warnings.push(`Not included in this PDF (each is marked where it occurred): ${joinList(omissions)}.`);
  }

  const mathMessages = conv.messages.filter((m) => m.hasMath).map((m) => m.index + 1);
  if (mathMessages.length > 0) {
    const one = mathMessages.length === 1;
    warnings.push(
      `${one ? 'Message' : 'Messages'} ${joinList(mathMessages.map(String))} ${one ? 'contains' : 'contain'} maths, shown as LaTeX source rather than typeset formulas.`
    );
  }

  return { passed: omissions.length === 0, omissions, mathMessages };
}

function checkExtractionStatus(conv, errors) {
  if (conv.extractionStatus === 'failed') {
    errors.push('The conversation could not be read, so no PDF was made.');
    return { passed: false, partial: false };
  }
  // Partial is not fatal: the PDF is generated with a visible INCOMPLETE banner.
  return { passed: true, partial: conv.extractionStatus === 'partial' };
}

function checkSourceVerification(conv, warnings, notes) {
  const v = conv.verification;
  const verified =
    v.isVerified === true &&
    v.exactTextMatch === true &&
    ['independent_source_match', 'dom_and_payload_crosscheck'].includes(v.verificationMethod);

  // The reason a conversion is unverified is stated once, by the grade text
  // in the PDF banner and the UI; the extractor's note says how it was read.
  if (v.notes) notes.push(v.notes);
  for (const m of v.mismatches || []) warnings.push(m);

  return { verified, method: v.verificationMethod };
}
