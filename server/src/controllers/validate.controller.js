import { ValidateUrlRequestSchema } from '../schemas/request.schema.js';
import { validateConversationUrl } from '../services/urlValidator.service.js';
import { getSupportedPlatformsMeta } from '../services/platformDetector.service.js';
import { AppError } from '../utils/errors.js';

/**
 * Controller for validating a user-supplied conversation URL in real-time.
 */
export async function validateUrl(req, res, next) {
  try {
    const parseResult = ValidateUrlRequestSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      throw new AppError('INVALID_REQUEST', parseResult.error.errors[0]?.message || 'Invalid request body');
    }

    const validation = await validateConversationUrl(parseResult.data.url, req.app.locals.validatorOptions);
    if (!validation.isValid) {
      throw new AppError('UNSUPPORTED_URL', validation.error);
    }

    res.status(200).json({
      success: true,
      data: {
        isValid: true,
        platform: validation.platform,
        platformName: validation.platformName,
        shareId: validation.shareId,
        canonicalUrl: validation.canonicalUrl
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller returning metadata of supported AI platforms.
 */
export function getPlatforms(req, res) {
  res.status(200).json({
    success: true,
    data: getSupportedPlatformsMeta()
  });
}
