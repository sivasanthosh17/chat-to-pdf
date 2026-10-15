/**
 * chatgpt.extractor.js
 *
 * Extracts public ChatGPT shared conversations (chatgpt.com/share/<id>).
 *
 * Retrieval tiers:
 *   1. GET https://chatgpt.com/backend-api/share/<id> — the JSON the share
 *      page itself loads. Not an officially documented API, but verified
 *      against live public shares (Oct 2026): returns { title, mapping,
 *      current_node, linear_conversation, ... } without authentication.
 *   2. Rendered DOM via a network-restricted headless browser, used only if
 *      tier 1 fails for a reason other than "not found". DOM output cannot
 *      be verified against an independent source and is labelled unverified.
 *
 * Which messages are included mirrors what the public share page displays:
 *   - user prompts and assistant replies addressed to the user (recipient "all")
 *   - hidden messages (system prompt, memory context, hidden flags) are skipped
 *   - tool calls, tool output, code execution and reasoning traces are NOT
 *     reproduced; each occurrence is counted and shown in the PDF as an
 *     explicit "not included" notice, and reported as an omission.
 *
 * Verification: the conversation is extracted by walking `mapping` parent
 * pointers from `current_node`. It is then compared exactly — message count,
 * roles, order and every character — against `linear_conversation`, a
 * separate server-provided list of the active branch.
 */

import * as cheerio from 'cheerio';
import { NormalizedConversationSchema } from '../schemas/conversation.schema.js';
import { ALLOWED_PLATFORMS } from '../services/urlValidator.service.js';
import { safeFetch } from '../services/safeFetch.service.js';
import { withBrowserPage } from '../services/browser.service.js';
import { AppError, normalizeUpstreamError } from '../utils/errors.js';
import { buildTextMessage, buildHtmlMessage } from './shared/messageBuilder.js';
import { htmlToBlocks, referenceText } from './shared/htmlBlocks.js';

export { parseStructuredBlocks } from './shared/markdown.js';

const PLATFORM = ALLOWED_PLATFORMS.chatgpt;

// ChatGPT encodes inline citations as private-use-area markers, e.g.
// "citeturn0search1", described by metadata.content_references.
const CITATION_MARKER_REGEX = /[^]*/g;
const PRIVATE_USE_CHAR_REGEX = /[-]/;

// ── Message classification ───────────────────────────────────────────────────

/**
 * Decides how a raw ChatGPT message is treated.
 * @param {object|null} message
 * @returns {{ kind: 'message', role: string } | { kind: 'omit', label: string } | { kind: 'skip' }}
 */
export function classifyChatGptMessage(message) {
  if (!message) return { kind: 'skip' };

  const role = message.author?.role;
  const contentType = message.content?.content_type;

  if (message.metadata?.is_visually_hidden_from_conversation === true) return { kind: 'skip' };
  if (role === 'system') return { kind: 'skip' };
  if (contentType === 'model_editable_context' || contentType === 'user_editable_context') return { kind: 'skip' };

  if (role === 'tool') return { kind: 'omit', label: 'tool output' };
  if (role === 'assistant' && message.recipient && message.recipient !== 'all') return { kind: 'omit', label: 'tool call' };
  if (contentType === 'thoughts' || contentType === 'reasoning_recap') return { kind: 'omit', label: 'reasoning' };
  if (role !== 'user' && role !== 'assistant') return { kind: 'skip' };

  if (contentType === 'text' || contentType === 'multimodal_text') return { kind: 'message', role };
  return { kind: 'omit', label: contentType ? contentType.replace(/_/g, ' ') : 'unsupported content' };
}

function partLabel(part) {
  const type = part?.content_type || 'non-text content';
  if (/image/.test(type)) return 'image';
  if (/audio/.test(type)) return 'audio';
  if (/video/.test(type)) return 'video';
  return type.replace(/_/g, ' ');
}

/** True when a visible message has something to show. */
function hasRenderableContent(message) {
  const parts = message.content?.parts || [];
  return parts.some((p) => (typeof p === 'string' ? p.length > 0 : p != null)) ||
    (message.metadata?.attachments?.length ?? 0) > 0;
}

/**
 * Replaces citation markers with the label ChatGPT displays for them
 * (content_references[].alt). Unresolvable markers are removed and counted.
 * @returns {{ displayText: string, replaced: number, unresolved: number }}
 */
export function resolveCitations(text, refs) {
  let out = text;
  let replaced = 0;

  const markers = (Array.isArray(refs) ? refs : [])
    .filter((r) => typeof r?.matched_text === 'string' && PRIVATE_USE_CHAR_REGEX.test(r.matched_text))
    .sort((a, b) => (b.start_idx ?? -1) - (a.start_idx ?? -1));

  for (const ref of markers) {
    const replacement = typeof ref.alt === 'string' ? ref.alt : '';
    if (Number.isInteger(ref.start_idx) && Number.isInteger(ref.end_idx) &&
        out.substring(ref.start_idx, ref.end_idx) === ref.matched_text) {
      out = out.slice(0, ref.start_idx) + replacement + out.slice(ref.end_idx);
      replaced++;
    } else {
      const i = out.indexOf(ref.matched_text);
      if (i !== -1) {
        out = out.slice(0, i) + replacement + out.slice(i + ref.matched_text.length);
        replaced++;
      }
    }
  }

  let unresolved = 0;
  out = out.replace(CITATION_MARKER_REGEX, () => {
    unresolved++;
    return '';
  });
  return { displayText: out, replaced, unresolved };
}

// ── Structured payload extraction ───────────────────────────────────────────

function activeBranch(mapping, currentNode) {
  const trail = [];
  const seen = new Set();

  if (currentNode && mapping[currentNode]) {
    let node = mapping[currentNode];
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      trail.push(node);
      node = node.parent ? mapping[node.parent] : null;
    }
    return trail.reverse();
  }

  // No current_node: follow the most recent child from the root
  let node = Object.values(mapping).find((n) => n.parent === null || n.parent === undefined);
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    trail.push(node);
    const children = Array.isArray(node.children) ? node.children : [];
    node = children.length ? mapping[children[children.length - 1]] : null;
  }
  return trail;
}

function summarizeOmissions(counts) {
  return Object.entries(counts)
    .map(([label, n]) => `${n} ${label}${n > 1 ? (label.endsWith('s') ? '' : 's') : ''}`)
    .join(', ');
}

/**
 * Independent reference built from `linear_conversation`.
 * @returns {Array<{ role: string, text: string }> | null}
 */
export function buildChatGptReference(serverData) {
  const linear = serverData?.linear_conversation;
  if (!Array.isArray(linear) || linear.length === 0) return null;

  const reference = [];
  for (const item of linear) {
    const message = item?.message;
    const cls = classifyChatGptMessage(message);
    if (cls.kind !== 'message' || !hasRenderableContent(message)) continue;
    let text = '';
    for (const part of message.content.parts || []) {
      if (typeof part === 'string') text += part;
    }
    reference.push({ role: message.author.role, text });
  }
  return reference;
}

/**
 * Core extraction from the ChatGPT mapping data structure.
 * @param {object} serverData  - Object with { mapping, current_node, title, linear_conversation, ... }
 * @param {string} sourceUrl
 * @returns {object|null}
 */
export function extractFromMappingData(serverData, sourceUrl) {
  if (!serverData?.mapping || typeof serverData.mapping !== 'object') return null;

  const title = serverData.title || serverData.og_title || 'ChatGPT Conversation';
  const branch = activeBranch(serverData.mapping, serverData.current_node);

  const messages = [];
  const warnings = [];
  const omissionTotals = {};
  let pendingOmissions = {};
  let citationsReplaced = 0;
  let citationsUnresolved = 0;

  const omittedBlock = (counts) => ({ type: 'omitted', kind: 'platform activity', label: summarizeOmissions(counts) });
  const attachPending = (target, position) => {
    if (Object.keys(pendingOmissions).length === 0 || !target) return;
    const block = omittedBlock(pendingOmissions);
    if (position === 'start') target.structuredBlocks.unshift(block);
    else target.structuredBlocks.push(block);
    pendingOmissions = {};
  };

  for (const node of branch) {
    const message = node.message;
    const cls = classifyChatGptMessage(message);

    if (cls.kind === 'skip') continue;
    if (cls.kind === 'omit') {
      pendingOmissions[cls.label] = (pendingOmissions[cls.label] || 0) + 1;
      omissionTotals[cls.label] = (omissionTotals[cls.label] || 0) + 1;
      continue;
    }
    if (!hasRenderableContent(message)) continue;

    // Text parts verbatim; non-text parts become explicit notices
    let originalText = '';
    const partNotices = [];
    for (const part of message.content.parts || []) {
      if (typeof part === 'string') originalText += part;
      else if (part != null) partNotices.push({ type: 'omitted', kind: partLabel(part), label: '' });
    }
    for (const att of message.metadata?.attachments || []) {
      partNotices.push({ type: 'omitted', kind: 'attachment', label: typeof att?.name === 'string' ? att.name : '' });
    }
    for (const n of partNotices) {
      const label = n.kind === 'attachment' ? 'attachment' : n.kind;
      omissionTotals[label] = (omissionTotals[label] || 0) + 1;
    }

    let displayText;
    if (cls.role === 'assistant' && PRIVATE_USE_CHAR_REGEX.test(originalText)) {
      const resolved = resolveCitations(originalText, message.metadata?.content_references);
      displayText = resolved.displayText;
      citationsReplaced += resolved.replaced;
      citationsUnresolved += resolved.unresolved;
    }

    const { message: built, formattingFallback } = buildTextMessage({
      index: messages.length,
      role: cls.role,
      originalText,
      displayText,
      // ChatGPT shows user prompts as plain pre-wrapped text, not markdown
      plain: cls.role === 'user',
      extraBlocks: originalText ? partNotices : []
    });
    if (!originalText) built.structuredBlocks = partNotices;
    if (formattingFallback) {
      warnings.push(`Message ${built.index + 1}: markdown structure could not be reproduced exactly, so it is shown as plain text (content unchanged).`);
    }

    // Tool activity that happened before an assistant reply belongs to that
    // reply; activity left over before a user prompt belongs to the previous reply.
    if (cls.role === 'assistant') attachPending(built, 'start');
    else attachPending(messages[messages.length - 1] || built, messages.length ? 'end' : 'start');

    messages.push(built);
  }
  attachPending(messages[messages.length - 1], 'end');

  if (messages.length === 0) return null;

  // ── Independent cross-check against linear_conversation ────────────────
  const reference = buildChatGptReference(serverData);
  const mismatches = [];
  if (reference) {
    if (reference.length !== messages.length) {
      mismatches.push(`Message count differs: linear_conversation has ${reference.length}, extracted ${messages.length}.`);
    }
    const n = Math.min(reference.length, messages.length);
    for (let i = 0; i < n; i++) {
      if (reference[i].role !== messages[i].role) {
        mismatches.push(`Message ${i + 1}: role "${messages[i].role}" but source says "${reference[i].role}".`);
      } else if (reference[i].text !== messages[i].originalText) {
        mismatches.push(`Message ${i + 1}: text differs from source (${reference[i].text.length} vs ${messages[i].originalText.length} characters).`);
      }
    }
  }

  const unsupportedOmissions = Object.entries(omissionTotals).map(
    ([label, count]) => `${count} × ${label}`
  );
  if (citationsUnresolved > 0) {
    warnings.push(`${citationsUnresolved} citation marker(s) had no source label and were removed.`);
  }

  const exactTextMatch = reference !== null && mismatches.length === 0;
  const notes = [
    reference
      ? 'Compared message-by-message against the payload\'s linear_conversation list.'
      : 'Payload had no linear_conversation list; no independent reference was available.',
    citationsReplaced ? `${citationsReplaced} inline citation marker(s) were replaced with the source labels ChatGPT displays.` : null
  ].filter(Boolean).join(' ');

  return {
    platform: 'chatgpt',
    conversationId: sourceUrl.split('/share/')[1]?.split(/[?#]/)[0]?.split('/').pop() || 'chatgpt-share',
    sourceUrl,
    title,
    extractedAt: new Date().toISOString(),
    messages,
    extractionStatus: mismatches.length ? 'partial' : 'complete',
    warnings,
    verification: {
      isVerified: exactTextMatch,
      verificationMethod: reference ? 'independent_source_match' : 'unverified',
      sourceMessageCount: reference ? reference.length : messages.length,
      extractedMessageCount: messages.length,
      exactTextMatch,
      whitespacePreserved: exactTextMatch,
      unsupportedOmissions,
      mismatches,
      notes
    }
  };
}

/**
 * Extracts conversation from a legacy ChatGPT __NEXT_DATA__ payload.
 * @param {object} nextData
 * @param {string} sourceUrl
 * @returns {object|null}
 */
export function extractFromNextData(nextData, sourceUrl) {
  const pageProps = nextData?.props?.pageProps;
  if (!pageProps) return null;

  const serverData = pageProps.serverResponse?.data || pageProps.sharedConversation || pageProps.conversation;
  if (!serverData?.mapping) return null;

  return extractFromMappingData(serverData, sourceUrl);
}

/**
 * Extracts conversation turns from rendered share-page DOM.
 * No independent source exists for DOM output, so it is never marked verified.
 * @param {string} html
 * @param {string} sourceUrl
 * @returns {object|null}
 */
export function extractFromDom(html, sourceUrl) {
  const $ = cheerio.load(html);
  const title = $('title').text().replace(/^ChatGPT\s*[-|]\s*/i, '').replace(/\s*\|\s*ChatGPT.*$/i, '').trim() || 'ChatGPT Conversation';

  const elements = $('[data-message-author-role]').toArray();
  if (elements.length === 0) return null;

  const messages = [];
  const warnings = [];
  const mismatches = [];
  const omissions = [];

  for (const el of elements) {
    const roleAttr = $(el).attr('data-message-author-role');
    if (roleAttr !== 'user' && roleAttr !== 'assistant') continue;

    const raw = referenceText($, el);
    if (!raw.trim()) continue;

    if (roleAttr === 'user') {
      // User bubbles are plain pre-wrapped text: keep the raw text exactly
      const { message } = buildTextMessage({ index: messages.length, role: 'user', originalText: raw.trim(), plain: true });
      messages.push(message);
      continue;
    }

    const converted = htmlToBlocks($, el);
    omissions.push(...converted.omissions.map((o) => `message ${messages.length + 1}: ${o}`));
    const { message, formattingFallback, crossCheck } = buildHtmlMessage({
      index: messages.length,
      role: 'assistant',
      converted,
      referenceText: raw
    });
    if (formattingFallback) {
      mismatches.push(`Message ${message.index + 1}: formatted text did not match raw page text at character ${crossCheck.firstDifferenceAt}; plain text used.`);
      warnings.push(`Message ${message.index + 1}: shown as plain text because its formatting could not be reproduced exactly.`);
    }
    messages.push(message);
  }

  if (messages.length === 0) return null;

  return {
    platform: 'chatgpt',
    conversationId: sourceUrl.split('/share/')[1]?.split(/[?#]/)[0]?.split('/').pop() || 'chatgpt-share',
    sourceUrl,
    title,
    extractedAt: new Date().toISOString(),
    messages,
    extractionStatus: 'complete',
    warnings,
    verification: {
      isVerified: false,
      verificationMethod: 'dom_structure_crosscheck',
      sourceMessageCount: messages.length,
      extractedMessageCount: messages.length,
      exactTextMatch: mismatches.length === 0,
      whitespacePreserved: false,
      unsupportedOmissions: omissions,
      mismatches,
      notes: 'Extracted from the rendered page only. The page may virtualise or lazy-load long conversations, and no independent source payload was available, so completeness is not verified.'
    }
  };
}

/**
 * Parses raw HTML from a ChatGPT share page (saved fixture or rendered DOM).
 * @param {string} html
 * @param {string} sourceUrl
 * @returns {object} Validated NormalizedConversation
 */
export function parseChatGptHtml(html, sourceUrl) {
  const $ = cheerio.load(html);

  // Strategy 1: legacy __NEXT_DATA__ JSON embedded in the page
  const nextDataScript = $('script#__NEXT_DATA__').html();
  if (nextDataScript) {
    try {
      const extracted = extractFromNextData(JSON.parse(nextDataScript), sourceUrl);
      if (extracted) return NormalizedConversationSchema.parse(extracted);
    } catch {
      // Fall back to DOM strategy
    }
  }

  // Strategy 2: rendered DOM message elements
  const domExtracted = extractFromDom(html, sourceUrl);
  if (domExtracted) return NormalizedConversationSchema.parse(domExtracted);

  throw new AppError(
    'UNRECOGNIZED_FORMAT',
    'Failed to extract conversation: neither __NEXT_DATA__ nor message elements could be found in the provided HTML.'
  );
}

/**
 * Parses the JSON returned by backend-api/share/<id>.
 * @param {object} data
 * @param {string} sourceUrl
 * @returns {object} Validated NormalizedConversation
 */
export function parseChatGptSharePayload(data, sourceUrl) {
  const extracted = extractFromMappingData(data, sourceUrl);
  if (!extracted) {
    throw new AppError('UNRECOGNIZED_FORMAT', 'ChatGPT returned a share payload without any displayable messages.');
  }
  return NormalizedConversationSchema.parse(extracted);
}

// ── Live retrieval ───────────────────────────────────────────────────────────

/**
 * Tier 1: the share page's JSON payload.
 * @returns {Promise<object>} NormalizedConversation
 */
async function fetchSharePayload(validation, options) {
  const response = await safeFetch(`https://chatgpt.com/backend-api/share/${encodeURIComponent(validation.shareId)}`, {
    allowedHosts: PLATFORM.fetchHosts,
    headers: { Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://chatgpt.com/' },
    ...options.fetchOptions
  });

  let body = null;
  try {
    body = JSON.parse(response.text);
  } catch {
    body = null;
  }

  if (response.status === 404 || body?.detail?.reason === 'not_found') {
    throw new AppError('NOT_FOUND', 'This ChatGPT conversation was not found. It may have been deleted, made private, or the link is incomplete.');
  }
  if (response.headers.get('cf-mitigated') === 'challenge') {
    throw new AppError('ACCESS_BLOCKED', 'ChatGPT presented a bot-verification challenge. This app does not bypass access controls; please retry later.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new AppError('NOT_FOUND', 'This ChatGPT conversation is not publicly accessible.');
  }
  if (response.status >= 500 && /can'?t load shared conversation/i.test(body?.detail?.description || '')) {
    throw new AppError('NOT_FOUND', 'ChatGPT could not load this shared conversation. Check that the link is complete and still shared.');
  }
  if (response.status === 429 || response.status >= 500) {
    throw new AppError('UPSTREAM_ERROR', `ChatGPT returned HTTP ${response.status}. Please retry shortly.`);
  }
  if (!response.ok || !body) {
    throw new AppError('UNRECOGNIZED_FORMAT', `Unexpected response from ChatGPT (HTTP ${response.status}).`);
  }

  return parseChatGptSharePayload(body, validation.canonicalUrl);
}

/**
 * Tier 2: rendered page DOM inside a network-restricted browser.
 * @returns {Promise<object>} NormalizedConversation
 */
async function renderSharePage(validation) {
  const html = await withBrowserPage(async (page) => {
    const response = await page.goto(validation.canonicalUrl, { waitUntil: 'domcontentloaded' });
    if (response?.status() === 404) {
      throw new AppError('NOT_FOUND', 'This ChatGPT conversation was not found.');
    }
    const title = await page.title();
    if (/just a moment|attention required/i.test(title)) {
      throw new AppError('ACCESS_BLOCKED', 'ChatGPT presented a bot-verification challenge. This app does not bypass access controls.');
    }
    await page.waitForSelector('[data-message-author-role]', { timeout: 25_000 }).catch(() => {
      throw new AppError('UNRECOGNIZED_FORMAT', 'The ChatGPT share page did not show any conversation messages.');
    });
    await page.waitForTimeout(1000);
    return page.content();
  }, { hostSuffixes: PLATFORM.browserHostSuffixes, timeoutMs: 60_000 });

  return parseChatGptHtml(html, validation.canonicalUrl);
}

/**
 * Fetches and extracts a public ChatGPT shared conversation.
 *
 * @param {object} validation - result of validateConversationUrl()
 * @param {object} [options]
 * @param {object} [options.fetchOptions] - passed to safeFetch (tests)
 * @param {boolean} [options.allowBrowserFallback=true]
 * @returns {Promise<object>} Validated NormalizedConversation
 */
export async function extractChatGptConversation(validation, options = {}) {
  const { allowBrowserFallback = true } = options;

  try {
    return await fetchSharePayload(validation, options);
  } catch (err) {
    const tierOneError = normalizeUpstreamError(err, 'ChatGPT');
    // Definitive answers from the platform are not retried another way
    if (['NOT_FOUND', 'ACCESS_BLOCKED', 'RESPONSE_TOO_LARGE'].includes(tierOneError.code) || !allowBrowserFallback) {
      throw tierOneError;
    }
    try {
      return await renderSharePage(validation);
    } catch (domErr) {
      const tierTwoError = normalizeUpstreamError(domErr, 'ChatGPT');
      throw tierTwoError.code === 'UNRECOGNIZED_FORMAT' ? tierOneError : tierTwoError;
    }
  }
}
