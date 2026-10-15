import { z } from 'zod';

/**
 * Schema for incoming URL validation requests.
 */
export const ValidateUrlRequestSchema = z.object({
  url: z.string({ required_error: 'A URL string is required' }).trim().min(1, 'A URL string is required').max(2048, 'URL is too long')
});

/**
 * Schema for incoming extraction / conversion requests.
 * `platform` is optional: "auto" (default) detects it from the URL; any other
 * value must match the detected platform.
 */
export const ConvertRequestSchema = z.object({
  url: z.string({ required_error: 'A conversation URL is required' }).trim().min(1, 'A conversation URL is required').max(2048, 'URL is too long'),
  platform: z.enum(['auto', 'chatgpt', 'gemini', 'claude']).default('auto'),
  // Presentation choices made at download time. They never change the
  // verified source text; anything left out is marked in the PDF.
  options: z
    .object({
      // Show only the first N lines of the user's own messages
      userMessageMaxLines: z.number().int().min(1).max(500).nullable().optional(),
      // Print the verification summary box on the first page (off by default).
      // The INCOMPLETE warning and in-place "not included" notices always print.
      includeVerificationSummary: z.boolean().optional()
    })
    .strict()
    .default({})
});
