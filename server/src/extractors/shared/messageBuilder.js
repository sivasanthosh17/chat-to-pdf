/**
 * messageBuilder.js
 *
 * Builds normalized messages and guarantees that the structured blocks used
 * for PDF layout carry the complete message text.
 *
 * If block parsing would lose or alter any character (checked in compact,
 * whitespace-insensitive form), the blocks are replaced by a single
 * preformatted paragraph containing the full text: formatting degrades,
 * content never does. Every fallback is reported.
 */

import { parseStructuredBlocks, markdownToComparableText, containsMath } from './markdown.js';
import { blocksToPlainText, compareCompact } from './textCompare.js';

function flagsFor(blocks, text) {
  return {
    hasCodeBlocks: blocks.some((b) => b.type === 'code'),
    hasTables: blocks.some((b) => b.type === 'table'),
    hasMath: containsMath(text)
  };
}

/**
 * Message whose source is markdown (ChatGPT / Claude assistant replies) or
 * plain text (user prompts, which platforms display verbatim).
 *
 * @param {object} p
 * @param {number} p.index
 * @param {'user'|'assistant'} p.role
 * @param {string} p.originalText       - verbatim source text
 * @param {string} [p.displayText]      - originalText with internal markup resolved
 * @param {boolean} [p.plain]           - true → no markdown interpretation
 * @param {object[]} [p.extraBlocks]    - e.g. "omitted" notices appended after the content
 * @returns {{ message: object, formattingFallback: boolean }}
 */
export function buildTextMessage({ index, role, originalText, displayText, plain = false, extraBlocks = [] }) {
  const text = displayText ?? originalText;
  let blocks;
  let formattingFallback = false;

  if (plain) {
    blocks = [{ type: 'paragraph', text, preformatted: true }];
  } else {
    blocks = parseStructuredBlocks(text);
    const cmp = compareCompact(markdownToComparableText(text), blocksToPlainText(blocks));
    if (!cmp.match) {
      blocks = [{ type: 'paragraph', text, preformatted: true }];
      formattingFallback = true;
    }
  }

  const message = {
    index,
    role,
    originalText,
    ...(displayText !== undefined && displayText !== originalText ? { displayText } : {}),
    structuredBlocks: [...blocks, ...extraBlocks],
    ...flagsFor(blocks, text)
  };
  if (plain) message.hasCodeBlocks = false;

  return { message, formattingFallback };
}

/**
 * Message whose source is rendered HTML that has already been converted with
 * htmlToBlocks(). `referenceText` is the element's independent raw text.
 *
 * @param {object} p
 * @param {number} p.index
 * @param {'user'|'assistant'} p.role
 * @param {{ blocks: object[], text: string, hasMath: boolean }} p.converted
 * @param {string} p.referenceText
 * @returns {{ message: object, formattingFallback: boolean, crossCheck: object }}
 */
export function buildHtmlMessage({ index, role, converted, referenceText }) {
  const crossCheck = compareCompact(referenceText, blocksToPlainText(converted.blocks));
  let blocks = converted.blocks;
  let originalText = converted.text;
  let formattingFallback = false;

  if (!crossCheck.match) {
    // Fall back to the raw text with HTML whitespace collapsed per line
    originalText = referenceText
      .split('\n')
      .map((l) => l.replace(/[ \t\r\f]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    blocks = [
      { type: 'paragraph', text: originalText, preformatted: true },
      ...converted.blocks.filter((b) => b.type === 'omitted')
    ];
    formattingFallback = true;
  }

  return {
    message: {
      index,
      role,
      originalText,
      structuredBlocks: blocks,
      hasCodeBlocks: blocks.some((b) => b.type === 'code'),
      hasTables: blocks.some((b) => b.type === 'table'),
      hasMath: converted.hasMath || containsMath(originalText)
    },
    formattingFallback,
    crossCheck
  };
}
