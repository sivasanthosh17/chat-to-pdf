import { retrieveAndVerify } from '../services/conversion.service.js';

/**
 * POST /api/extract
 * Body: { url: string, platform?: string }
 *
 * Returns the normalized conversation and its verification report as JSON
 * (used by the "Preview messages" view). Nothing is stored server-side.
 */
export async function extractConversation(req, res, next) {
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abort.abort(new DOMException('Client cancelled the request', 'AbortError'));
  });
  res.locals.onTimeout = () => abort.abort(new DOMException('Request timed out', 'AbortError'));

  try {
    const { conversation, report } = await retrieveAndVerify(req.body, req.app.locals, { signal: abort.signal });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      data: conversation,
      verification: {
        grade: report.grade,
        passed: report.passed,
        warnings: report.warnings,
        errors: report.errors,
        notes: report.notes
      }
    });
  } catch (err) {
    if (abort.signal.aborted) return undefined; // client is gone or a 504 was already sent
    next(err);
  }
}
