/**
 * markdown.js
 *
 * Converts markdown source text (as stored by platforms such as ChatGPT and
 * Claude) into structured content blocks for PDF layout.
 *
 * Content-fidelity rules:
 *   - Block text is copied from the source verbatim; only markdown block
 *     syntax (fences, "#", ">", list markers, table pipes) is consumed.
 *   - Code block contents keep their exact whitespace and indentation.
 *   - Anything not recognised stays in a paragraph, unchanged.
 *
 * markdownToComparableText() is a deliberately separate, minimal routine that
 * removes the same block syntax from the *source*; verification compares its
 * output with the text recovered from the blocks to detect content dropped by
 * the parser.
 */

const CODE_FENCE_REGEX = /```([a-zA-Z0-9_+#.-]*)[^\S\n]*\n([\s\S]*?)```/g;
const TABLE_SEPARATOR_REGEX = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const TABLE_ROW_REGEX = /^\s*\|.*\|\s*$/;

/**
 * Detects LaTeX-style math (\( \), \[ \], $$ $$, or $...$ containing TeX syntax).
 * Plain currency such as "$5 and $10" does not match.
 * @param {string} text
 * @returns {boolean}
 */
export function containsMath(text) {
  if (typeof text !== 'string') return false;
  return /\\\(|\\\[|\$\$[\s\S]+?\$\$|\$[^$\n]*[\\^_{}][^$\n]*\$/.test(text);
}

/**
 * Parses markdown-like text into structured content blocks while preserving verbatim text.
 * @param {string} text
 * @returns {Array<object>}
 */
export function parseStructuredBlocks(text) {
  const blocks = [];
  if (!text || typeof text !== 'string') return blocks;

  // Split by code blocks first to protect code indentation and syntax
  const codeBlockRegex = new RegExp(CODE_FENCE_REGEX.source, 'g');
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const preText = text.substring(lastIndex, match.index).trim();
    if (preText) {
      parseMarkdownSegment(preText, blocks);
    }

    blocks.push({
      type: 'code',
      language: match[1] || 'text',
      code: match[2] // Verbatim code with exact indentation
    });

    lastIndex = match.index + match[0].length;
  }

  const remaining = text.substring(lastIndex).trim();
  if (remaining) {
    parseMarkdownSegment(remaining, blocks);
  }

  // Fallback if no blocks created
  if (blocks.length === 0) {
    blocks.push({ type: 'paragraph', text });
  }

  return blocks;
}

/**
 * Splits a markdown table row into trimmed cell strings.
 * Escaped pipes (\|) stay inside the cell.
 * @param {string} line
 * @returns {string[]}
 */
function splitTableRow(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\' && inner[i + 1] === '|') {
      current += '\\|';
      i++;
    } else if (inner[i] === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += inner[i];
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Parses a non-code markdown segment into heading / table / list / blockquote / paragraph blocks.
 * Preserves all original text verbatim — does NOT rewrite or summarise content.
 * @param {string} segment
 * @param {Array} blocks  - mutated in place
 */
function parseMarkdownSegment(segment, blocks) {
  const lines = segment.split('\n');
  let buffer = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const joined = buffer.join('\n').trim();
    if (joined) blocks.push({ type: 'paragraph', text: joined });
    buffer = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // ATX heading: # / ## / ### / #### / ##### / ######
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushBuffer();
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim()
      });
      i++;
      continue;
    }

    // GFM table: header row followed by a separator row
    if (
      TABLE_ROW_REGEX.test(line) &&
      i + 1 < lines.length &&
      TABLE_SEPARATOR_REGEX.test(lines[i + 1]) &&
      lines[i + 1].includes('|')
    ) {
      flushBuffer();
      const headers = splitTableRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && TABLE_ROW_REGEX.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Blockquote: lines starting with >
    if (/^\s*>\s?/.test(line)) {
      flushBuffer();
      const quoteLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', text: quoteLines.join('\n') });
      continue;
    }

    // Unordered list: lines starting with - / * / +
    if (/^\s*[-*+]\s+/.test(line)) {
      flushBuffer();
      const items = [];
      const itemDepths = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        itemDepths.push(Math.min(Math.floor(lines[i].match(/^\s*/)[0].length / 2), 6));
        items.push(lines[i].replace(/^\s*[-*+]\s+/, '').trim());
        i++;
      }
      blocks.push({ type: 'list', ordered: false, items, itemDepths });
      continue;
    }

    // Ordered list: lines starting with 1. / 2. / etc. The first number is kept
    // so a list that starts at 3 is not rendered as starting at 1.
    if (/^\s*\d+\.\s+/.test(line)) {
      flushBuffer();
      const items = [];
      const itemDepths = [];
      const start = Number(line.match(/^\s*(\d+)\./)[1]);
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        itemDepths.push(Math.min(Math.floor(lines[i].match(/^\s*/)[0].length / 3), 6));
        items.push(lines[i].replace(/^\s*\d+\.\s+/, '').trim());
        i++;
      }
      blocks.push({ type: 'list', ordered: true, start, items, itemDepths });
      continue;
    }

    // Everything else: accumulate into paragraph buffer
    buffer.push(line);
    i++;
  }

  flushBuffer();
}

/**
 * Removes markdown *block* syntax from source text, leaving every content
 * character. Independent of parseStructuredBlocks() on purpose.
 * @param {string} text
 * @returns {string}
 */
export function markdownToComparableText(text) {
  if (typeof text !== 'string') return '';
  const parts = [];
  const fence = new RegExp(CODE_FENCE_REGEX.source, 'g');
  let last = 0;
  let m;

  const stripSegment = (segment) =>
    segment
      .split('\n')
      // Only table separator rows (which contain a pipe) are syntax; a bare
      // "---" is a horizontal rule that the parser keeps as paragraph text.
      .filter((l) => !(TABLE_SEPARATOR_REGEX.test(l) && l.includes('|')))
      // One prefix per line, in the parser's precedence order: "### 2. Title"
      // is a heading whose text is "2. Title".
      .map((l) => {
        if (/^#{1,6}\s+\S/.test(l)) return l.replace(/^#{1,6}\s+/, '');
        if (/^\s*>\s?/.test(l)) return l.replace(/^\s*>\s?/, '');
        if (/^\s*[-*+]\s+/.test(l)) return l.replace(/^\s*[-*+]\s+/, '');
        return l.replace(/^\s*\d+\.\s+/, '');
      })
      .join('\n');

  while ((m = fence.exec(text)) !== null) {
    parts.push(stripSegment(text.substring(last, m.index)));
    parts.push(m[2]);
    last = m.index + m[0].length;
  }
  parts.push(stripSegment(text.substring(last)));
  return parts.join('\n');
}
