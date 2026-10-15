/**
 * claude.extractor.js
 *
 * Extracts public Claude shared conversations (claude.ai/share/<id>).
 *
 * ── Real-world behaviour (tested Oct 2026) ───────────────────────────────────
 * The share page loads its data from
 *   GET /api/chat_snapshots/<id>?rendering_mode=messages&render_all_tools=true
 * The extractor never calls that endpoint itself: it opens the public page in
 * a network-restricted browser and passively reads the JSON response the page
 * requests.
 *
 * claude.ai sometimes protects /share/* with a Cloudflare bot-verification
 * challenge ("Just a moment…", snapshot request → 403). It was presented
 * intermittently during testing. This project does NOT bypass bot protection
 * (no stealth plugins, no challenge solving); when the challenge appears the
 * conversion ends with a clear ACCESS_BLOCKED error and the user can retry.
 *
 * ── Payload shape (verified on live public shares) ───────────────────────────
 *   { snapshot_name, chat_messages: [ { uuid, parent_message_uuid, index,
 *     sender: 'human'|'assistant', text: '' (empty in snapshots),
 *     content: [ { type: 'text', text, citations } | { type: 'tool_use', name, ... }
 *               | { type: 'tool_result', ... } ],
 *     attachments: [], files: [] } ] }
 * Anything that does not match fails closed with UNRECOGNIZED_FORMAT.
 */

import * as cheerio from 'cheerio';
import { NormalizedConversationSchema } from '../schemas/conversation.schema.js';
import { ALLOWED_PLATFORMS } from '../services/urlValidator.service.js';
import { withBrowserPage } from '../services/browser.service.js';
import { AppError, normalizeUpstreamError } from '../utils/errors.js';
import { buildTextMessage } from './shared/messageBuilder.js';
import { compareCompact } from './shared/textCompare.js';

const PLATFORM = ALLOWED_PLATFORMS.claude;
const SNAPSHOT_PATH_REGEX = /^\/api\/chat_snapshots\/[A-Za-z0-9_-]+$/;

const ACCESS_BLOCKED_MESSAGE =
  'Claude protects shared links with a Cloudflare bot-verification check that automated browsers cannot pass. ' +
  'This app does not bypass access controls, so Claude conversations cannot be converted automatically right now. ' +
  'Open the link in your own browser and use its Print → Save as PDF instead.';

/**
 * Detects a Cloudflare (or similar) interstitial instead of the share page.
 * @param {{ title?: string, url?: string, html?: string }} page
 * @returns {boolean}
 */
export function isAccessChallenge({ title = '', url = '', html = '' }) {
  if (/just a moment|attention required|verify you are human/i.test(title)) return true;
  if (/\/api\/challenge_redirect|\/cdn-cgi\/challenge-platform/i.test(url)) return true;
  if (html) {
    const $ = cheerio.load(html);
    const pageTitle = $('title').text();
    if (/just a moment|attention required/i.test(pageTitle)) return true;
    if ($('#challenge-form, #cf-challenge-running, [name="cf-turnstile-response"]').length) return true;
    if (/Performing security verification|challenges\.cloudflare\.com/i.test(html) && !/chat_messages/.test(html)) return true;
  }
  return false;
}

function contentLabel(item) {
  switch (item?.type) {
    case 'tool_use':
      return item.name === 'artifacts' ? 'artifact' : 'tool use';
    case 'tool_result':
      return 'tool result';
    case 'thinking':
    case 'redacted_thinking':
      return 'reasoning';
    case 'image':
      return 'image';
    default:
      return item?.type ? String(item.type).replace(/_/g, ' ') : 'non-text content';
  }
}

/**
 * Parses a Claude chat snapshot / conversation JSON object.
 * @param {object} data
 * @param {string} sourceUrl
 * @returns {object} Validated NormalizedConversation
 */
export function parseClaudeSnapshot(data, sourceUrl) {
  const chatMessages = data?.chat_messages;
  if (!Array.isArray(chatMessages) || chatMessages.length === 0) {
    throw new AppError('UNRECOGNIZED_FORMAT', 'The Claude share data did not contain a recognisable message list.');
  }

  const title = data.snapshot_name || data.name || 'Claude Conversation';
  const messages = [];
  const warnings = [];
  const mismatches = [];
  const omissionTotals = {};
  let crossCheckedMessages = 0;

  // ── Order / completeness: parent links must form one unbroken chain ──
  // (verified on live shares: chat_messages[i].parent_message_uuid ===
  // chat_messages[i-1].uuid, and the first message points at a root id)
  const hasChainFields = chatMessages.every((m) => typeof m?.uuid === 'string' && typeof m?.parent_message_uuid === 'string');
  let chainVerified = false;
  if (hasChainFields) {
    const breaks = [];
    for (let i = 1; i < chatMessages.length; i++) {
      if (chatMessages[i].parent_message_uuid !== chatMessages[i - 1].uuid) breaks.push(i + 1);
    }
    if (breaks.length) {
      mismatches.push(`Message chain is broken before source message(s) ${breaks.join(', ')} — messages may be missing or out of order.`);
    } else {
      chainVerified = true;
    }
  }
  const indices = chatMessages.map((m) => m?.index);
  if (indices.every(Number.isInteger) && indices.some((v, i) => i > 0 && v <= indices[i - 1])) {
    warnings.push('Message index fields are not strictly increasing.');
  }

  chatMessages.forEach((raw, i) => {
    const role = raw?.sender === 'human' ? 'user' : raw?.sender === 'assistant' ? 'assistant' : null;
    if (!role) {
      mismatches.push(`Source message ${i + 1}: unknown sender "${raw?.sender}" was not included.`);
      return;
    }

    // Text: prefer the content array (keeps text segments separate from tool
    // activity); fall back to the flat `text` field.
    const notices = [];
    let originalText;
    if (Array.isArray(raw.content) && raw.content.length > 0) {
      const segments = [];
      const activity = {};
      for (const item of raw.content) {
        if (!item || item.hidden_in_chat === true) continue; // not displayed by Claude
        if (item.type === 'text' && typeof item.text === 'string') {
          segments.push(item.text);
        } else {
          const label = contentLabel(item);
          omissionTotals[label] = (omissionTotals[label] || 0) + 1;
          activity[label] = (activity[label] || 0) + 1;
        }
      }
      originalText = segments.join('\n\n');
      if (Object.keys(activity).length) {
        notices.push({
          type: 'omitted',
          kind: 'platform activity',
          label: Object.entries(activity).map(([label, n]) => `${n} ${label}${n > 1 ? 's' : ''}`).join(', ')
        });
      }

      // Share snapshots leave the flat `text` field empty (observed on live
      // shares). When a payload does fill it, it is a second copy to compare.
      if (typeof raw.text === 'string' && raw.text.length > 0) {
        crossCheckedMessages++;
        if (!compareCompact(raw.text, originalText).match) {
          mismatches.push(`Message ${messages.length + 1}: content segments differ from the message's text field.`);
        }
      }
    } else if (typeof raw.text === 'string') {
      originalText = raw.text;
    } else {
      mismatches.push(`Source message ${i + 1}: no text content found.`);
      return;
    }

    for (const file of [...(raw.attachments || []), ...(raw.files || [])]) {
      omissionTotals.attachment = (omissionTotals.attachment || 0) + 1;
      notices.push({ type: 'omitted', kind: 'attachment', label: typeof file?.file_name === 'string' ? file.file_name : '' });
    }

    if (!originalText.trim() && notices.length === 0) return;

    const { message, formattingFallback } = buildTextMessage({
      index: messages.length,
      role,
      originalText,
      plain: role === 'user',
      extraBlocks: originalText.trim() ? notices : []
    });
    if (!originalText.trim()) message.structuredBlocks = notices;
    if (formattingFallback) {
      warnings.push(`Message ${message.index + 1}: markdown structure could not be reproduced exactly, so it is shown as plain text (content unchanged).`);
    }
    messages.push(message);
  });

  if (messages.length === 0) {
    throw new AppError('UNRECOGNIZED_FORMAT', 'The Claude share data contained no readable messages.');
  }

  // Verified only when the order/completeness chain holds AND every message
  // carried a second, agreeing copy of its text.
  const isVerified = chainVerified && crossCheckedMessages === chatMessages.length && mismatches.length === 0;

  return NormalizedConversationSchema.parse({
    platform: 'claude',
    conversationId: sourceUrl.split('/share/')[1]?.split(/[?#/]/)[0] || 'claude-share',
    sourceUrl,
    title,
    extractedAt: new Date().toISOString(),
    messages,
    extractionStatus: mismatches.length ? 'partial' : 'complete',
    warnings,
    verification: {
      isVerified,
      verificationMethod: isVerified ? 'independent_source_match' : 'unverified',
      sourceMessageCount: chatMessages.length,
      extractedMessageCount: messages.length,
      exactTextMatch: isVerified,
      whitespacePreserved: isVerified,
      unsupportedOmissions: Object.entries(omissionTotals).map(
        ([label, count]) => `${count} × ${label}`
      ),
      mismatches,
      notes: [
        chainVerified
          ? 'Message order and completeness confirmed: every message links to the previous one (parent_message_uuid chain).'
          : 'Message order could not be confirmed from parent links.',
        isVerified
          ? 'Every message\'s text matched a second copy in the payload.'
          : 'Claude share data contains only one copy of each message\'s text, so the exact text cannot be independently verified.'
      ].join(' ')
    }
  });
}

/**
 * Loads a public Claude share page and extracts it, if the platform allows
 * automated access.
 *
 * @param {object} validation - result of validateConversationUrl()
 * @param {{ signal?: AbortSignal }} [options] - aborting stops the browser job
 * @returns {Promise<object>} Validated NormalizedConversation
 */
export async function extractClaudeConversation(validation, { signal } = {}) {
  try {
    const snapshot = await withBrowserPage(async (page) => {
      let captured = null;
      let snapshotStatus = null;

      // Passively observe the share page's own data request
      page.on('response', async (response) => {
        try {
          const url = new URL(response.url());
          if (url.hostname !== 'claude.ai' || !SNAPSHOT_PATH_REGEX.test(url.pathname)) return;
          snapshotStatus = response.status();
          if (response.ok()) captured = await response.json();
        } catch {
          // Body unavailable or not JSON — handled below
        }
      });

      await page.goto(validation.canonicalUrl, { waitUntil: 'domcontentloaded' });

      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && captured === null) {
        const title = await page.title().catch(() => '');
        if (isAccessChallenge({ title, url: page.url() })) {
          // Give a non-interactive challenge a moment to clear on its own; we do not interact with it
          await page.waitForTimeout(5_000);
          const after = await page.title().catch(() => '');
          if (isAccessChallenge({ title: after, url: page.url() })) {
            throw new AppError('ACCESS_BLOCKED', ACCESS_BLOCKED_MESSAGE);
          }
        }
        if (snapshotStatus === 404) {
          throw new AppError('NOT_FOUND', 'This Claude conversation was not found. It may have been unshared or deleted.');
        }
        if (snapshotStatus === 401 || snapshotStatus === 403) {
          const title = await page.title().catch(() => '');
          throw isAccessChallenge({ title, url: page.url() })
            ? new AppError('ACCESS_BLOCKED', ACCESS_BLOCKED_MESSAGE)
            : new AppError('NOT_FOUND', 'This Claude conversation is not publicly accessible.');
        }
        await page.waitForTimeout(500);
      }

      if (captured === null) {
        throw new AppError('UNRECOGNIZED_FORMAT', 'The Claude share page did not load any conversation data.');
      }
      return captured;
    }, { hostSuffixes: PLATFORM.browserHostSuffixes, timeoutMs: 60_000, signal });

    return parseClaudeSnapshot(snapshot, validation.canonicalUrl);
  } catch (err) {
    throw normalizeUpstreamError(err, 'Claude');
  }
}
