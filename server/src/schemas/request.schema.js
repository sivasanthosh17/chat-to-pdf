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
  platform: z.enum(['auto', 'chatgpt', 'gemini', 'claude']).default('auto')
});
