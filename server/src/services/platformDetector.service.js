import { ALLOWED_PLATFORMS, validateConversationUrl } from './urlValidator.service.js';

/**
 * What each extractor can honestly promise. Shown in the UI and README.
 */
export const PLATFORM_CAPABILITIES = {
  chatgpt: {
    verification: 'independent',
    note: 'Verified message-by-message against an independent copy in the share data.'
  },
  gemini: {
    verification: 'unverified',
    note: 'Read from the rendered page; no independent source exists, so conversions are labelled unverified.'
  },
  claude: {
    verification: 'unverified',
    note: 'Order and completeness checked via message links; text has no second copy, so conversions are labelled unverified. Claude sometimes shows a bot check that this app will not bypass.'
  }
};

/**
 * Detects the AI platform from a given URL and validates consistency.
 * @param {string} urlString
 * @param {string} [requestedPlatform] - Optional requested platform to assert against
 * @param {object} [validatorOptions]
 * @returns {Promise<{ ok: boolean, platform?: string, platformName?: string, shareId?: string, error?: string }>}
 */
export async function detectPlatform(urlString, requestedPlatform = null, validatorOptions = {}) {
  const validation = await validateConversationUrl(urlString, validatorOptions);

  if (!validation.isValid) {
    return {
      ok: false,
      error: validation.error
    };
  }

  // If the user specified a platform, ensure it matches the actual detected platform
  if (requestedPlatform && requestedPlatform !== 'auto') {
    const normalizedReq = requestedPlatform.toLowerCase().trim();
    if (normalizedReq !== validation.platform) {
      return {
        ok: false,
        error: `Platform mismatch: URL belongs to ${validation.platformName}, but "${requestedPlatform}" was requested.`
      };
    }
  }

  return {
    ok: true,
    platform: validation.platform,
    platformName: validation.platformName,
    shareId: validation.shareId
  };
}

/**
 * Returns supported platforms and example URL formats.
 */
export function getSupportedPlatformsMeta() {
  return Object.values(ALLOWED_PLATFORMS).map((p) => ({
    id: p.id,
    name: p.displayName,
    allowedHosts: p.hostnames,
    exampleUrl: `https://${p.hostnames[0]}/share/example-id`,
    ...PLATFORM_CAPABILITIES[p.id]
  }));
}
