/**
 * pdf.service.js
 *
 * Renders the final PDF from a NormalizedConversation using Playwright +
 * Chromium.
 *
 * Design decisions:
 *   - page.setContent() with a fully self-contained HTML document; the browser
 *     context has NO network access (empty host allowlist) and JavaScript is
 *     disabled, so nothing from the conversation can execute or phone home.
 *   - Post-render regression check: the generated PDF's own text layer is read
 *     back (PDF.js) and every rendered text segment — paragraph, heading, list
 *     item, table cell, code block — must appear in it, in order. This detects
 *     content lost between HTML and PDF (clipping, dropped glyph runs).
 *   - If that check fails, the report is downgraded with an explicit warning
 *     and the PDF is rendered once more so its banner tells the truth.
 *   - PDFs are returned as Buffers and never written to disk.
 */

import { buildConversationHtml } from '../templates/conversation.template.js';
import { withBrowserPage } from '../services/browser.service.js';
import { extractPdfText, compareSegmentsToPdf } from './pdfText.js';
import { messageList } from '../utils/wording.js';

const PDF_RENDER_TIMEOUT_MS = Number(process.env.PDF_RENDER_TIMEOUT_MS) || 90_000;

const PDF_OPTIONS = {
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: '20mm', bottom: '22mm', left: '18mm', right: '18mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div style="font-size:7pt;color:#aaa;width:100%;text-align:right;padding-right:18mm;margin-top:5mm;">Chat-to-PDF Converter</div>',
  footerTemplate: '<div style="font-size:7pt;color:#aaa;width:100%;text-align:center;margin-bottom:5mm;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>'
};

/**
 * Collects rendered text segments (in document order) that must appear in the
 * PDF. Runs inside the page.
 */
function collectSegmentsInPage() {
  const selector = 'p, h1, h2, h3, h4, h5, h6, li, th, td, pre, blockquote';
  const segments = [];
  document.querySelectorAll('.message-turn').forEach((turn) => {
    const messageIndex = Number(turn.getAttribute('data-message-index'));
    const body = turn.querySelector('.message-body');
    if (!body) return;
    body.querySelectorAll(selector).forEach((el) => {
      if (el.closest('[data-nocompare]')) return;
      // Skip containers whose text is covered by a nested segment element
      if (el.querySelector(selector)) return;
      segments.push({ messageIndex, text: el.textContent || '' });
    });
  });
  return segments;
}

async function renderOnce(html, signal) {
  return withBrowserPage(
    async (page) => {
      await page.setContent(html, { waitUntil: 'load', timeout: PDF_RENDER_TIMEOUT_MS });
      const segments = await page.evaluate(collectSegmentsInPage);
      const buffer = await page.pdf(PDF_OPTIONS);
      return { buffer, segments };
    },
    { hostSuffixes: [], javaScriptEnabled: false, timeoutMs: PDF_RENDER_TIMEOUT_MS, signal }
  );
}

/**
 * @param {object} report
 * @param {object} regressionCheck
 * @returns {object} report with an explicit regression warning and adjusted grade
 */
function downgradeReport(report, regressionCheck) {
  const affected = [...new Set(regressionCheck.failures.map((f) => f.messageIndex + 1))];
  const where = affected.length ? ` from ${messageList(affected)}` : '';
  const warning =
    `The final check of this PDF could not find some text${where}. Please compare ${affected.length === 1 ? 'it' : 'them'} with the original before relying on it. ` +
    '(Right-to-left scripts such as Arabic can trigger this check by mistake.)';
  return {
    ...report,
    grade: report.grade === 'verified' ? 'verified_with_warnings' : report.grade,
    warnings: [...report.warnings, warning]
  };
}

/**
 * @typedef {object} PdfResult
 * @property {Buffer} buffer
 * @property {object} regressionCheck - result of the post-render text check
 * @property {object} report          - final verification report (possibly downgraded)
 * @property {number} pageCount
 */

/**
 * Renders a conversation to a PDF buffer using Playwright.
 *
 * @param {object} conversation   - NormalizedConversation (already verified)
 * @param {object} report         - VerificationReport from verification.service.js
 * @param {object} [options]
 * @param {(stage: string) => void} [options.onStage] - progress callback ('rendering' | 'checking')
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<PdfResult>}
 */
export async function renderConversationToPdf(conversation, report, { onStage = () => {}, signal } = {}) {
  onStage('rendering');
  const first = await renderOnce(buildConversationHtml(conversation, report), signal);

  onStage('checking');
  const pdfText = await extractPdfText(first.buffer);
  const pageCount = pdfText.pageCount;
  const regressionCheck = compareSegmentsToPdf(first.segments, pdfText);

  if (regressionCheck.passed) {
    return { buffer: first.buffer, regressionCheck, report, pageCount };
  }

  const finalReport = downgradeReport(report, regressionCheck);
  onStage('rendering');
  const second = await renderOnce(buildConversationHtml(conversation, finalReport), signal);
  return { buffer: second.buffer, regressionCheck, report: finalReport, pageCount };
}
