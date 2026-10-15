/**
 * conversion.service.js
 *
 * Shared pipeline used by /api/extract and /api/convert:
 *   validate request → validate URL (SSRF) → detect platform →
 *   check requested platform → extract → verify.
 * PDF rendering is left to the convert controller.
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
 * @returns {Promise<{ validation: object, conversation: object, report: object }>}
 */
export async function retrieveAndVerify(body, { extractors, validatorOptions = {} }) {
  const parsed = ConvertRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new AppError('INVALID_REQUEST', parsed.error.errors[0]?.message || 'Invalid request body.');
  }
  const { url, platform: requestedPlatform } = parsed.data;

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

  let conversation;
  try {
    conversation = await extractor(validation);
  } catch (err) {
    throw normalizeUpstreamError(err, validation.platformName);
  }

  const report = verifyConversation(conversation);
  return { validation, conversation, report };
}
