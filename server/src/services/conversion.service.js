/**
 * conversion.service.js
 *
 * Shared pipeline used by /api/extract, /api/convert and /api/convert/stream:
 *   validate request → validate URL (SSRF) → detect platform →
 *   check requested platform → extract → verify.
 * PDF rendering is left to the convert controllers.
 */

import { ConvertRequestSchema } from '../schemas/request.schema.js';
import { validateConversationUrl } from './urlValidator.service.js';
import { verifyConversation } from '../verification/verification.service.js';
import { AppError, normalizeUpstreamError } from '../utils/errors.js';

/**
 * @param {unknown} body - raw request body
 * @param {object} deps
 * @param {object} deps.extractors          - platform → extractor function
 * @param {object} [deps.validatorOptions]  - passed to validateConversationUrl
 * @param {object} [progress]
 * @param {(stage: string, info?: object) => void} [progress.onStage] - 'validating' | 'retrieving' | 'verifying'
 * @param {AbortSignal} [progress.signal]   - cancels extraction (closes its browser)
 * @returns {Promise<{ validation: object, conversation: object, report: object, options: object }>}
 */
export async function retrieveAndVerify(body, { extractors, validatorOptions = {} }, { onStage = () => {}, signal } = {}) {
  const parsed = ConvertRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new AppError('INVALID_REQUEST', parsed.error.errors[0]?.message || 'Invalid request body.');
  }
  const { url, platform: requestedPlatform, options } = parsed.data;

  onStage('validating');
  const validation = await validateConversationUrl(url, validatorOptions);
  if (!validation.isValid) {
    throw new AppError('UNSUPPORTED_URL', validation.error);
  }

  if (requestedPlatform !== 'auto' && requestedPlatform !== validation.platform) {
    throw new AppError(
      'PLATFORM_MISMATCH',
      `This link belongs to ${validation.platformName}, but "${requestedPlatform}" was selected. Choose "Auto-detect" or the matching platform.`
    );
  }

  const extractor = extractors[validation.platform];
  if (typeof extractor !== 'function') {
    throw new AppError('UNSUPPORTED_URL', `No extractor is available for ${validation.platformName}.`);
  }

  onStage('retrieving', { platform: validation.platform });
  let conversation;
  try {
    conversation = await extractor(validation, { signal });
  } catch (err) {
    throw normalizeUpstreamError(err, validation.platformName);
  }
  if (signal?.aborted) throw new AppError('CANCELLED', 'The conversion was cancelled.');

  onStage('verifying', { messageCount: conversation.messages.length });
  const report = verifyConversation(conversation);
  return { validation, conversation, report, options };
}
