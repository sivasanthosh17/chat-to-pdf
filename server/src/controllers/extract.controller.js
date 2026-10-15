import { retrieveAndVerify } from '../services/conversion.service.js';

/**
 * POST /api/extract
 * Body: { url: string, platform?: string }
 *
 * Returns the normalized conversation and its verification report as JSON
 * (used by the "Inspect" view). Nothing is stored server-side.
 */
export async function extractConversation(req, res, next) {
  try {
    const { conversation, report } = await retrieveAndVerify(req.body, req.app.locals);
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
    next(err);
  }
}
