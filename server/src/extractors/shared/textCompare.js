/**
 * textCompare.js
 *
 * Helpers for whitespace-insensitive, character-exact content comparison.
 *
 * Rendering legitimately changes *layout* whitespace (line wrapping, list
 * indentation, table cell padding, PDF text-run splitting), so comparisons
 * are made on a "compact" form: Unicode NFKC-normalised, with all whitespace
 * and table pipes removed. Every other character — letters, digits,
 * punctuation, symbols, emoji, non-Latin scripts — must match exactly and in
 * order.
 */

/**
 * @param {string} text
 * @returns {string}
 */
export function compactForComparison(text) {
  if (typeof text !== 'string') return '';
  return text.normalize('NFKC').replace(/[\s|​‌‍﻿]+/g, '');
}

/**
 * Concatenates the content carried by structured blocks.
 * @param {Array<object>} blocks
 * @returns {string}
 */
export function blocksToPlainText(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'paragraph':
        case 'heading':
        case 'quote':
          return b.text;
        case 'code':
          return b.code;
        case 'list':
          return (b.items || []).join('\n');
        case 'table':
          return [(b.headers || []).join(' '), ...(b.rows || []).map((r) => r.join(' '))].join('\n');
        case 'omitted':
          return ''; // placeholder for content that is reported as not included
        default:
          return '';
      }
    })
    .join('\n');
}

/**
 * Compares two texts in compact form.
 * @param {string} expected
 * @param {string} actual
 * @returns {{ match: boolean, expectedLength: number, actualLength: number, firstDifferenceAt: number }}
 */
export function compareCompact(expected, actual) {
  const a = compactForComparison(expected);
  const b = compactForComparison(actual);
  if (a === b) {
    return { match: true, expectedLength: a.length, actualLength: b.length, firstDifferenceAt: -1 };
  }
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return { match: false, expectedLength: a.length, actualLength: b.length, firstDifferenceAt: i };
}
