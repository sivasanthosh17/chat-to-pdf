/**
 * Platform → extractor registry.
 *
 * Every extractor has the signature
 *   (validation: ValidatedUrl) => Promise<NormalizedConversation>
 * and throws AppError on failure. Tests replace entries via
 * createApp({ extractors }) instead of reaching into production code.
 */

import { extractChatGptConversation } from './chatgpt.extractor.js';
import { extractGeminiConversation } from './gemini.extractor.js';
import { extractClaudeConversation } from './claude.extractor.js';

export const defaultExtractors = Object.freeze({
  chatgpt: extractChatGptConversation,
  gemini: extractGeminiConversation,
  claude: extractClaudeConversation
});
