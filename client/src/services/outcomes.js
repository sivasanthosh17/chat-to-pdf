/**
 * Maps backend verification grades and error codes onto the user-facing
 * outcome categories the app must keep distinct:
 *   verified · verified with warnings · unverified · incomplete ·
 *   unsupported URL · private/inaccessible · blocked by platform ·
 *   temporary network/platform failure · verification failed · unreadable page
 */

export const PLATFORM_NAMES = { chatgpt: 'ChatGPT', gemini: 'Google Gemini', claude: 'Claude' };

export const GRADE_OUTCOMES = {
  verified: {
    tone: 'success',
    title: 'Converted and verified',
    description: 'Every message was compared character-for-character with an independent copy in the platform\'s data.'
  },
  verified_with_warnings: {
    tone: 'success',
    title: 'Converted and verified — with warnings',
    description: 'The messages match the platform\'s data, but some content could not be reproduced or needs your attention. See the warnings.'
  },
  unverified: {
    tone: 'info',
    title: 'Converted, but unverified',
    description: 'The text was copied exactly as the page showed it, but this platform offers no independent source to confirm nothing is missing. The PDF says so on its first page.'
  },
  incomplete: {
    tone: 'warning',
    title: 'Converted — extraction incomplete',
    description: 'Some messages could not be retrieved. The PDF is clearly marked INCOMPLETE; do not treat it as the full conversation.'
  }
};

const ERROR_OUTCOMES = {
  UNSUPPORTED_URL: { tone: 'error', title: 'Unsupported link', hint: 'Paste a public share link: chatgpt.com/share/…, gemini.google.com/share/… (or share.gemini.google/… · g.co/gemini/share/…), or claude.ai/share/….' },
  INVALID_REQUEST: { tone: 'error', title: 'Unsupported link', hint: 'Paste a full https:// share link.' },
  PLATFORM_MISMATCH: { tone: 'error', title: 'Platform does not match the link', hint: 'Choose “Auto-detect” or the platform the link belongs to.' },
  NOT_FOUND: { tone: 'error', title: 'Private or inaccessible conversation', hint: 'Check that the link is complete and that the conversation is still shared publicly. Private chats cannot be converted.' },
  ACCESS_BLOCKED: { tone: 'error', title: 'Blocked by the platform', hint: 'The platform asked for a human verification check. This app never bypasses such checks. Try again later.' },
  UNRECOGNIZED_FORMAT: { tone: 'error', title: 'Could not read the conversation', hint: 'The platform may have changed its page layout. No PDF was created rather than risk an incomplete one.' },
  EXTRACTION_FAILED: { tone: 'error', title: 'Could not read the conversation', hint: 'Please retry. If it keeps failing, the platform may have changed its page.' },
  VERIFICATION_FAILED: { tone: 'error', title: 'Verification failed — no PDF created', hint: 'The extracted content did not pass integrity checks, so no PDF was produced.' },
  TIMEOUT: { tone: 'temporary', title: 'Temporary network or platform problem', hint: 'The platform took too long to respond. Retrying usually helps.' },
  UPSTREAM_ERROR: { tone: 'temporary', title: 'Temporary network or platform problem', hint: 'The platform returned an error. Retry in a moment.' },
  NETWORK: { tone: 'temporary', title: 'Cannot reach the server', hint: 'Check your connection and that the backend is running.' },
  BUSY: { tone: 'temporary', title: 'Server busy', hint: 'Other conversions are running. Retry in a minute.' },
  RATE_LIMITED: { tone: 'temporary', title: 'Too many conversions', hint: 'Please wait a little before converting again.' },
  RESPONSE_TOO_LARGE: { tone: 'error', title: 'Conversation too large', hint: 'This conversation exceeds the server\'s size limit.' },
  PDF_FAILED: { tone: 'temporary', title: 'PDF generation failed', hint: 'Retry. If it keeps failing, check the server logs.' },
  CANCELLED: { tone: 'neutral', title: 'Conversion cancelled', hint: '' },
  UNAUTHENTICATED: { tone: 'error', title: 'Please log in', hint: 'Your session has ended. Log in again to continue.' },
  FORBIDDEN: { tone: 'error', title: 'Not allowed', hint: '' },
  CONFLICT: { tone: 'error', title: 'Already exists', hint: '' },
  INTERNAL: { tone: 'temporary', title: 'Unexpected server error', hint: 'Retry. If it keeps failing, check the server logs.' }
};

/**
 * @param {{ code: string, message: string, retryable?: boolean }} error
 */
export function describeError(error) {
  const base = ERROR_OUTCOMES[error?.code] || ERROR_OUTCOMES.INTERNAL;
  return { ...base, message: error?.message || '', retryable: error?.retryable ?? base.tone === 'temporary' };
}
