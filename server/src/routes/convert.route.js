/**
 * convert.route.js
 *
 * Mounts the POST /api/convert endpoint.
 * Rate limiting and the request timeout are applied in app.js.
 */

import { Router } from 'express';
import { convertToPdf } from '../controllers/convert.controller.js';

const router = Router();

/**
 * POST /api/convert
 *
 * Body:
 *   { url: string, platform?: 'auto' | 'chatgpt' | 'gemini' | 'claude' }
 *
 * Success response:
 *   Binary PDF (application/pdf)
 *   Headers:
 *     X-Verification-Grade:   verified | verified_with_warnings | unverified | incomplete
 *     X-Verification-Warnings: <count>
 *     X-Verification-Report:  URI-encoded JSON { grade, method, notes, warnings }
 *     X-Regression-Check:     passed | failed
 *     X-Message-Count / X-Page-Count / X-Platform
 *
 * Error response:
 *   { success: false, error: { code, message, statusCode, retryable, details? } }
 */
router.post('/convert', convertToPdf);

export default router;
