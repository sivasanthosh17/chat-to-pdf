/**
 * downloadOptions.service.js
 *
 * Applies presentation choices the user makes at download time — currently
 * "show only the first N lines of my own messages" — to an already verified
 * conversation.
 *
 * Rules:
 *   - Runs AFTER verification, on a copy. The verified conversation and its
 *     originalText are untouched.
 *   - Only the user's own messages are shortened (they are plain text, so a
 *     line cut never splits a code block or table). Assistant replies are
 *     always complete.
 *   - Every shortened message gets a visible in-place notice, and the report
 *     lists the change so the PDF's first page states it.
 */

import { plural } from '../utils/wording.js';

export function countLines(text) {
  if (!text) return 0;
  return text.replace(/\n+$/, '').split('\n').length;
}

/**
 * Line counts of the user's messages, so the UI can tell how many would be
 * shortened for any limit without receiving the text itself.
 */
export function userMessageLineCounts(conversation) {
  return conversation.messages.filter((m) => m.role === 'user').map((m) => countLines(m.originalText));
}

/**
 * @param {object} conversation - verified NormalizedConversation
 * @param {object} report       - its VerificationReport
 * @param {{ userMessageMaxLines?: number|null, includeVerificationSummary?: boolean }} options
 * @returns {{ conversation: object, report: object, applied: object }}
 */
export function applyDownloadOptions(conversation, report, options = {}) {
  const includeVerificationSummary = options.includeVerificationSummary === true;
  const shortened = shortenUserMessages(conversation, report, options.userMessageMaxLines);
  return {
    conversation: shortened.conversation,
    // The template prints the summary box only when asked to
    report: { ...shortened.report, showSummary: includeVerificationSummary },
    applied: { ...shortened.applied, includeVerificationSummary }
  };
}

function shortenUserMessages(conversation, report, maxLines) {
  if (!maxLines) return { conversation, report, applied: {} };

  let shortenedMessages = 0;
  let omittedLines = 0;

  const messages = conversation.messages.map((msg) => {
    if (msg.role !== 'user') return msg;
    const lines = msg.originalText.replace(/\n+$/, '').split('\n');
    if (lines.length <= maxLines) return msg;

    const hidden = lines.length - maxLines;
    shortenedMessages++;
    omittedLines += hidden;

    // Keep non-text notices (attachments, images) that belonged to the message
    const notices = (msg.structuredBlocks || []).filter((b) => b.type === 'omitted');
    return {
      ...msg,
      structuredBlocks: [
        { type: 'paragraph', text: lines.slice(0, maxLines).join('\n'), preformatted: true },
        {
          type: 'omitted',
          // Rendered as "Not included in this PDF: the rest of this message — 76 more lines, cut at download"
          kind: 'the rest of this message',
          label: `${plural(hidden, 'more line')}, cut at download`
        },
        ...notices
      ]
    };
  });

  if (shortenedMessages === 0) return { conversation, report, applied: { userMessageMaxLines: maxLines, shortenedMessages: 0 } };

  const adjustment =
    `Your messages are cut after ${plural(maxLines, 'line')}: ${plural(shortenedMessages, 'message')} shortened, ` +
    `${plural(omittedLines, 'line')} left out. Each cut is marked; replies are complete.`;

  return {
    conversation: { ...conversation, messages },
    report: { ...report, adjustments: [...(report.adjustments || []), adjustment] },
    applied: { userMessageMaxLines: maxLines, shortenedMessages, omittedLines }
  };
}
