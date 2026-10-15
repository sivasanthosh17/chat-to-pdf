/**
 * convert.controller.js
 *
 * Handles POST /api/convert
 *
 * Pipeline:
 *   1. Validate request body (Zod)            — 400 INVALID_REQUEST
 *   2. Validate & SSRF-check URL              — 422 UNSUPPORTED_URL
 *   3. Detect platform / check requested one  — 422 PLATFORM_MISMATCH
 *   4. Extract (platform-specific extractor)  — 404 / 403 / 502 / 504 …
 *   5. Verify                                 — 422 VERIFICATION_FAILED blocks the PDF
 *   6. Render PDF + post-render text check    — 500 PDF_FAILED
 *   7. Stream the PDF
 *
 * Verification policy:
 *   grade=failed                  → no PDF
 *   grade=incomplete              → PDF with an INCOMPLETE banner
 *   grade=unverified              → PDF labelled unverified
 *   grade=verified[_with_warnings]→ PDF labelled verified
 *
 * Response headers carry the outcome so the frontend can show the correct
 * status without parsing the PDF:
 *   X-Verification-Grade, X-Verification-Warnings, X-Regression-Check,
 *   X-Message-Count, X-Page-Count, X-Verification-Report (URI-encoded JSON)
 */

import { retrieveAndVerify } from '../services/conversion.service.js';
import { AppError } from '../utils/errors.js';

const MAX_REPORT_HEADER_CHARS = 6000;

/**
 * Serialises the user-facing parts of the report into a header value that
 * stays below common proxy header limits.
 */
export function encodeReportHeader(report, conversation) {
  const payload = {
    grade: report.grade,
    method: conversation.verification.verificationMethod,
    notes: report.notes,
    warnings: [...report.warnings]
  };
  let encoded = encodeURIComponent(JSON.stringify(payload));
  while (encoded.length > MAX_REPORT_HEADER_CHARS && payload.warnings.length > 0) {
    payload.warnings.pop();
    payload.truncated = true;
    encoded = encodeURIComponent(JSON.stringify(payload));
  }
  if (encoded.length > MAX_REPORT_HEADER_CHARS) {
    encoded = encodeURIComponent(JSON.stringify({ grade: report.grade, method: payload.method, truncated: true }));
  }
  return encoded;
}

export function safeFilename(platform, title) {
  const base = (title || 'conversation')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .substring(0, 80) || 'conversation';
  return `${platform}-${base}.pdf`;
}

/**
 * POST /api/convert
 * Body: { url: string, platform?: 'auto'|'chatgpt'|'gemini'|'claude' }
 */
export async function convertToPdf(req, res, next) {
  const started = Date.now();
  try {
    const { validation, conversation, report } = await retrieveAndVerify(req.body, req.app.locals);

    if (!report.passed) {
      throw new AppError(
        'VERIFICATION_FAILED',
        'Verification failed — PDF generation was blocked so that an incomplete or altered conversation is not presented as complete.',
        { grade: report.grade, verificationErrors: report.errors, verificationWarnings: report.warnings }
      );
    }

    let pdf;
    try {
      pdf = await req.app.locals.renderPdf(conversation, report);
    } catch (pdfErr) {
      if (pdfErr instanceof AppError) throw pdfErr;
      throw new AppError('PDF_FAILED', 'PDF generation failed. Please retry.');
    }

    const finalReport = pdf.report || report;

    // Metadata only — never conversation content
    console.log(
      `[convert] platform=${validation.platform} messages=${conversation.messages.length} grade=${finalReport.grade} ` +
        `pdfCheck=${pdf.regressionCheck.passed ? 'passed' : 'failed'} pages=${pdf.pageCount ?? '?'} ms=${Date.now() - started}`
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(validation.platform, conversation.title)}"`);
    res.setHeader('Content-Length', pdf.buffer.length);
    res.setHeader('X-Verification-Grade', finalReport.grade);
    res.setHeader('X-Verification-Warnings', String(finalReport.warnings.length));
    res.setHeader('X-Regression-Check', pdf.regressionCheck.passed ? 'passed' : 'failed');
    res.setHeader('X-Message-Count', String(conversation.messages.length));
    res.setHeader('X-Page-Count', String(pdf.pageCount ?? 0));
    res.setHeader('X-Platform', validation.platform);
    res.setHeader('X-Verification-Report', encodeReportHeader(finalReport, conversation));

    // Prevent caching of PDFs containing user conversation data
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');

    return res.status(200).send(pdf.buffer);
  } catch (err) {
    next(err);
  }
}

