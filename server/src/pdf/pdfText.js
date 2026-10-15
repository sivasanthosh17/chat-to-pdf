/**
 * pdfText.js
 *
 * Reads the text layer of a generated PDF (Mozilla PDF.js) so that content
 * can be compared against what was rendered. Used for the post-render
 * regression check and in tests.
 *
 * Two views of each page are produced:
 *   - stream order: text items in content-stream order (keeps multi-line
 *     table cells together)
 *   - visual order: items sorted into lines top-to-bottom, left-to-right
 * Chromium does not always paint text in document order (observed: a
 * verification banner's text written after part of the following message), so
 * neither view alone is a reliable reading order.
 *
 * Header and footer bands (page title / "Page X of Y") are excluded by
 * position: anything inside the top or bottom page margin is ignored.
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { compactForComparison } from '../extractors/shared/textCompare.js';

const MM_TO_PT = 72 / 25.4;
const LINE_TOLERANCE_PT = 2;

function toUint8Array(buffer) {
  if (buffer instanceof Uint8Array && !(buffer instanceof Buffer)) return buffer;
  return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

/**
 * @param {Buffer|Uint8Array} pdfBuffer
 * @param {object} [options]
 * @param {number} [options.topMarginMm=15]    - smallest top margin used by the template
 * @param {number} [options.bottomMarginMm=22]
 * @returns {Promise<{ pages: string[], visualPages: string[], pageCount: number }>}
 */
export async function extractPdfText(pdfBuffer, options = {}) {
  const { topMarginMm = 15, bottomMarginMm = 22 } = options;

  const loadingTask = getDocument({
    data: toUint8Array(pdfBuffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0
  });
  const doc = await loadingTask.promise;

  const pages = [];
  const visualPages = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const { height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const top = height - topMarginMm * MM_TO_PT + 2;
      const bottom = bottomMarginMm * MM_TO_PT - 2;

      const items = content.items.filter((item) => {
        if (typeof item.str !== 'string' || item.str === '') return false;
        const y = item.transform[5];
        return y <= top && y >= bottom; // drop header / footer band
      });

      pages.push(items.map((i) => i.str + (i.hasEOL ? '\n' : '')).join(''));

      const sorted = [...items].sort((a, b) => {
        const dy = b.transform[5] - a.transform[5];
        return Math.abs(dy) > LINE_TOLERANCE_PT ? dy : a.transform[4] - b.transform[4];
      });
      visualPages.push(sorted.map((i) => i.str).join(' '));
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  return { pages, visualPages, pageCount: pages.length };
}

// Hebrew, Arabic, Syriac, Thaana, NKo and their presentation forms
const RTL_RUN_REGEX = /[֐-ࣿיִ-﷿ﹰ-﻿]+/g;

/**
 * PDF text layers store right-to-left script in visual order (observed with
 * Chromium + PDF.js: "العربية" reads back as "ةيبرعلا"). Reversing each RTL
 * run of the compact expected text reproduces that order. RTL text mixed with
 * digits or Latin words inside the run can still differ.
 */
function rtlVisualOrder(compact) {
  return compact.replace(RTL_RUN_REGEX, (run) => [...run].reverse().join(''));
}

/**
 * Checks that every expected text segment is present in the PDF text layer.
 * Comparison is whitespace-insensitive and NFKC-normalised; every other
 * character must match. A segment passes if it is found in either the
 * stream-order or the visual-order text (with RTL runs in visual order).
 *
 * @param {Array<{ messageIndex: number, text: string }>} segments - rendered text segments
 * @param {{ pages: string[], visualPages?: string[] }} pdfText
 * @returns {{ passed: boolean, checkedCount: number, failureCount: number, failures: object[], method: string }}
 */
export function compareSegmentsToPdf(segments, pdfText) {
  const stream = compactForComparison(pdfText.pages.join('\n'));
  const visual = compactForComparison((pdfText.visualPages || []).join('\n'));
  const failures = [];
  let checked = 0;

  for (const segment of segments) {
    const needle = compactForComparison(segment.text);
    if (!needle) continue;
    checked++;
    const visualNeedle = rtlVisualOrder(needle);
    const candidates = visualNeedle === needle ? [needle] : [needle, visualNeedle];
    if (!candidates.some((c) => stream.includes(c) || visual.includes(c))) {
      failures.push({ messageIndex: segment.messageIndex, length: needle.length });
    }
  }

  return {
    passed: failures.length === 0,
    method: 'pdf_text_layer',
    checkedCount: checked,
    failureCount: failures.length,
    failures: failures.slice(0, 10)
  };
}
