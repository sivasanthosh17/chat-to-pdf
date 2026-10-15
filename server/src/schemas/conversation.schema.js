import { z } from 'zod';

/**
 * Message role in an AI conversation.
 */
export const MessageRoleSchema = z.enum(['user', 'assistant', 'system']);

/**
 * A run of inline text with optional formatting, produced from rendered DOM.
 * The PDF template re-emits these with its own fixed tag set, so no source
 * HTML ever reaches the PDF. Links are restricted to http(s).
 */
export const InlineRunSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  code: z.boolean().optional(),
  strike: z.boolean().optional(),
  math: z.boolean().optional(),
  href: z.string().url().refine((u) => /^https?:\/\//i.test(u), 'Only http(s) links are allowed').optional()
});

/**
 * Structured content block representation for high-fidelity formatting.
 *
 * Blocks that carry `runs` came from rendered HTML; their `text` is the plain
 * concatenation of the runs. Blocks without `runs` carry markdown source text.
 */
export const ContentBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('paragraph'),
    text: z.string(),
    runs: z.array(InlineRunSchema).optional(),
    // true → render verbatim with whitespace preserved and no markdown
    // interpretation (used for user prompts, which platforms display as plain text)
    preformatted: z.boolean().optional()
  }),
  z.object({
    type: z.literal('heading'),
    level: z.number().int().min(1).max(6),
    text: z.string(),
    runs: z.array(InlineRunSchema).optional()
  }),
  z.object({
    type: z.literal('code'),
    language: z.string().default('text'),
    code: z.string()
  }),
  z.object({
    type: z.literal('list'),
    ordered: z.boolean().default(false),
    start: z.number().int().nonnegative().optional(),
    items: z.array(z.string()),
    itemDepths: z.array(z.number().int().min(0).max(6)).optional(),
    itemRuns: z.array(z.array(InlineRunSchema)).optional()
  }),
  z.object({
    type: z.literal('table'),
    headers: z.array(z.string()),
    rows: z.array(z.array(z.string()))
  }),
  z.object({
    type: z.literal('quote'),
    text: z.string(),
    runs: z.array(InlineRunSchema).optional()
  }),
  z.object({
    // Placeholder for content that exists in the source but cannot be
    // reproduced (images, attachments, tool output). Rendered as a visible
    // notice so nothing disappears silently.
    type: z.literal('omitted'),
    kind: z.string(),
    label: z.string().default('')
  })
]);

/**
 * Single ordered conversation message schema.
 */
export const MessageSchema = z.object({
  index: z.number().int().nonnegative(),
  role: MessageRoleSchema,
  originalText: z.string(), // Verbatim, un-modified text from the source
  // originalText with platform-internal markup (e.g. ChatGPT citation markers)
  // resolved to what the platform displays. Omitted when identical.
  displayText: z.string().optional(),
  structuredBlocks: z.array(ContentBlockSchema).default([]),
  hasCodeBlocks: z.boolean().default(false),
  hasTables: z.boolean().default(false),
  hasMath: z.boolean().default(false),
  timestamp: z.string().optional()
});

/**
 * Extraction completeness status.
 */
export const ExtractionStatusSchema = z.enum(['complete', 'partial', 'failed']);

/**
 * Verification result reported by the extractor.
 *
 * verificationMethod:
 *   independent_source_match   – normalized messages compared exactly against
 *                                the platform's structured JSON payload
 *   dom_and_payload_crosscheck – rendered DOM compared against a payload
 *   dom_structure_crosscheck   – rendered DOM only: turn structure and text
 *                                cross-checked, but no independent source
 *                                exists, so completeness is NOT verified
 *   partial_unverified / unverified
 */
export const VerificationResultSchema = z.object({
  isVerified: z.boolean(),
  verificationMethod: z.enum([
    'independent_source_match',
    'dom_and_payload_crosscheck',
    'dom_structure_crosscheck',
    'partial_unverified',
    'unverified'
  ]),
  sourceMessageCount: z.number().int().nonnegative(),
  extractedMessageCount: z.number().int().nonnegative(),
  exactTextMatch: z.boolean(),
  whitespacePreserved: z.boolean(),
  unsupportedOmissions: z.array(z.string()).default([]),
  mismatches: z.array(z.string()).default([]),
  notes: z.string().optional()
});

/**
 * Common Canonical Conversation Schema for all platforms.
 */
export const NormalizedConversationSchema = z.object({
  platform: z.enum(['chatgpt', 'gemini', 'claude']),
  conversationId: z.string().min(1),
  sourceUrl: z.string().url(),
  title: z.string().nullable().default('AI Conversation'),
  extractedAt: z.string().datetime(),
  messages: z.array(MessageSchema).min(1, 'A conversation must have at least one message'),
  extractionStatus: ExtractionStatusSchema,
  warnings: z.array(z.string()).default([]),
  verification: VerificationResultSchema
});

/**
 * Factory helper to construct a normalized conversation conforming to the schema.
 */
export function createNormalizedConversation(data) {
  return NormalizedConversationSchema.parse(data);
}
