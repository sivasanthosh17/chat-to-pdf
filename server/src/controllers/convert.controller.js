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
import { AppError, toErrorBody } from '../utils/errors.js';

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
 * An AbortSignal that fires when the client disconnects before the response
 * is complete, so abandoned conversions release their browser immediately.
 */
function abortOnDisconnect(res) {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort(new DOMException('Client cancelled the request', 'AbortError'));
  });
  return controller;
}

/**
 * Shared steps after extraction: enforce the verification policy, render,
 * log metadata. Returns everything a response needs.
 */
async function verifyAndRender(req, { validation, conversation, report }, { onStage, signal }) {
  const started = Date.now();
  if (!report.passed) {
    throw new AppError(
      'VERIFICATION_FAILED',
      'Verification failed — PDF generation was blocked so that an incomplete or altered conversation is not presented as complete.',
      { grade: report.grade, verificationErrors: report.errors, verificationWarnings: report.warnings }
    );
  }

  let pdf;
  try {
    pdf = await req.app.locals.renderPdf(conversation, report, { onStage, signal });
  } catch (pdfErr) {
    if (pdfErr instanceof AppError) throw pdfErr;
    throw new AppError('PDF_FAILED', 'PDF generation failed. Please retry.');
  }

  const finalReport = pdf.report || report;

  // Metadata only — never conversation content
  console.log(
    `[convert] platform=${validation.platform} messages=${conversation.messages.length} grade=${finalReport.grade} ` +
      `pdfCheck=${pdf.regressionCheck.passed ? 'passed' : 'failed'} pages=${pdf.pageCount ?? '?'} renderMs=${Date.now() - started}`
  );

  return { pdf, finalReport };
}

/**
 * POST /api/convert
 * Body: { url: string, platform?: 'auto'|'chatgpt'|'gemini'|'claude' }
 */
export async function convertToPdf(req, res, next) {
  const abort = abortOnDisconnect(res);
  res.locals.onTimeout = () => abort.abort(new DOMException('Request timed out', 'AbortError'));
  try {
    const retrieved = await retrieveAndVerify(req.body, req.app.locals, { signal: abort.signal });
    const { validation, conversation } = retrieved;
    const { pdf, finalReport } = await verifyAndRender(req, retrieved, { signal: abort.signal });

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
    if (abort.signal.aborted) return undefined; // client is gone; nothing to send
    next(err);
  }
}

const HEARTBEAT_MS = 15_000;

/**
 * POST /api/convert/stream
 * Body: same as /api/convert
 *
 * Streams newline-delimited JSON so the UI can show which step is really
 * running:
 *   {"type":"stage","stage":"validating"}
 *   {"type":"stage","stage":"retrieving","platform":"gemini"}
 *   {"type":"stage","stage":"verifying","messageCount":40}
 *   {"type":"stage","stage":"rendering"}
 *   {"type":"stage","stage":"checking"}
 *   {"type":"ping"}                                   (every 15 s, keeps proxies from closing the connection)
 *   {"type":"result","meta":{…},"pdf":"<base64>"}    or
 *   {"type":"error","error":{code,message,statusCode,retryable,details?}}
 *
 * Errors raised before the first event (bad JSON, rate limit) are ordinary
 * JSON error responses with their HTTP status.
 */
export async function convertToPdfStream(req, res, next) {
  const abort = abortOnDisconnect(res);
  let streaming = false;

  const send = (event) => {
    if (res.writableEnded || res.destroyed) return;
    if (!streaming) {
      streaming = true;
      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('X-Accel-Buffering', 'no'); // disable nginx response buffering
      res.flushHeaders();
    }
    res.write(`${JSON.stringify(event)}\n`);
  };

  const fail = (err) => {
    if (abort.signal.aborted && err?.code !== 'TIMEOUT') return;
    if (!streaming) {
      next(err);
      return;
    }
    send({ type: 'error', error: toErrorBody(err).error });
    res.end();
  };

  // The request-timeout middleware cannot send a 504 once streaming has
  // started; it calls this instead.
  res.locals.onTimeout = () => {
    fail(new AppError('TIMEOUT', 'The conversion took too long and was stopped. Please retry.'));
    abort.abort(new DOMException('Request timed out', 'AbortError'));
  };

  const heartbeat = setInterval(() => streaming && send({ type: 'ping' }), HEARTBEAT_MS);
  try {
    // `at` is the server time the step started, so step durations are exact even when
    // several events arrive in one network chunk
    const onStage = (stage, info = {}) => send({ type: 'stage', stage, at: Date.now(), ...info });
    const retrieved = await retrieveAndVerify(req.body, req.app.locals, { onStage, signal: abort.signal });
    const { pdf, finalReport } = await verifyAndRender(req, retrieved, { onStage, signal: abort.signal });
    const { validation, conversation } = retrieved;

    send({
      type: 'result',
      meta: {
        filename: safeFilename(validation.platform, conversation.title),
        title: conversation.title,
        platform: validation.platform,
        grade: finalReport.grade,
        method: conversation.verification.verificationMethod,
        warnings: finalReport.warnings,
        notes: finalReport.notes,
        regressionCheck: pdf.regressionCheck.passed ? 'passed' : 'failed',
        messageCount: conversation.messages.length,
        pageCount: pdf.pageCount ?? 0
      },
      pdf: Buffer.from(pdf.buffer).toString('base64')
    });
    res.end();
  } catch (err) {
    fail(err instanceof AppError ? err : new AppError('INTERNAL', 'An unexpected server error occurred. Please retry.'));
  } finally {
    clearInterval(heartbeat);
  }
}

