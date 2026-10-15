/**
 * gemini.extractor.js
 *
 * Extracts public Google Gemini shared conversations
 * (gemini.google.com/share/<id>, also reached via g.co/gemini/share/<id>).
 *
 * Retrieval: the share page is rendered client-side (its data arrives through
 * Google's internal batchexecute RPC, which is undocumented and is NOT called
 * directly). We load the public page in a network-restricted headless
 * browser — exactly what a visitor's browser does — and read the rendered DOM.
 *
 * Page structure (verified against a live public share, Oct 2026):
 *
 *   share-viewer
 *     .share-title-section h1                     → conversation title
 *     share-turn-viewer (one per turn)
 *       user-query
 *         .query-text
 *           .cdk-visually-hidden                  → "You said …" screen-reader label (excluded)
 *           p.query-text-line (one per line)      → prompt text
 *         .file-preview-container                 → uploaded files, if any
 *       response-container
 *         message-content > div.markdown          → rendered reply (p, ul/ol/li, b, h1–h6, …)
 *   invalid-share-link-dialog                      → shown for deleted/unknown links
 *
 * Code blocks, tables, math and images were not present in the share used for
 * verification; they are handled by the generic HTML rules in
 * shared/htmlBlocks.js and still need real-world confirmation.
 *
 * Verification: DOM only, so completeness cannot be verified against an
 * independent source. We do cross-check turn structure (every turn must yield
 * one prompt and one reply) and that the structured blocks reproduce the raw
 * page text of every reply exactly; the result is labelled unverified.
 */

import * as cheerio from 'cheerio';
import { NormalizedConversationSchema } from '../schemas/conversation.schema.js';
import { ALLOWED_PLATFORMS } from '../services/urlValidator.service.js';
import { withBrowserPage } from '../services/browser.service.js';
import { AppError, normalizeUpstreamError } from '../utils/errors.js';
import { buildTextMessage, buildHtmlMessage } from './shared/messageBuilder.js';
import { htmlToBlocks, referenceText } from './shared/htmlBlocks.js';

const PLATFORM = ALLOWED_PLATFORMS.gemini;

export const GEMINI_SELECTORS = {
  invalidLink: 'invalid-share-link-dialog',
  turn: 'share-turn-viewer',
  title: 'share-viewer .share-title-section h1',
  userQuery: 'user-query',
  queryLine: '.query-text .query-text-line',
  queryText: '.query-text',
  attachments: '.file-preview-container',
  response: 'response-container message-content',
  responseMarkdown: '.markdown'
};

/**
 * Reads the prompt text verbatim: each p.query-text-line is one line.
 */
function readUserPrompt($, userEl) {
  const lines = $(userEl).find(GEMINI_SELECTORS.queryLine).toArray();
  if (lines.length > 0) {
    return lines.map((line) => referenceText($, line)).join('\n');
  }
  const container = $(userEl).find(GEMINI_SELECTORS.queryText).first();
  return container.length ? referenceText($, container[0]).trim() : '';
}

/**
 * Parses the rendered HTML of a Gemini share page.
 * @param {string} html
 * @param {string} sourceUrl
 * @returns {object} Validated NormalizedConversation
 */
export function parseGeminiHtml(html, sourceUrl) {
  const $ = cheerio.load(html);

  if ($(GEMINI_SELECTORS.invalidLink).length > 0) {
    throw new AppError('NOT_FOUND', 'Gemini reports that this shared link does not exist. It may have been deleted or the link is incomplete.');
  }

  const turns = $(GEMINI_SELECTORS.turn).toArray();
  if (turns.length === 0) {
    throw new AppError('UNRECOGNIZED_FORMAT', 'No conversation turns were found on the Gemini share page.');
  }

  const title = $(GEMINI_SELECTORS.title).first().text().trim() || 'Gemini Conversation';
  const messages = [];
  const warnings = [];
  const mismatches = [];
  const omissions = [];
  let expectedMessages = 0;

  turns.forEach((turn, t) => {
    const turnNo = t + 1;

    // ── User prompt ──
    const userEl = $(turn).find(GEMINI_SELECTORS.userQuery).first();
    if (userEl.length) {
      expectedMessages++;
      const prompt = readUserPrompt($, userEl[0]);
      const files = $(userEl).find(GEMINI_SELECTORS.attachments).children().length;
      const notices = Array.from({ length: files }, () => ({ type: 'omitted', kind: 'attachment', label: '' }));
      if (files) omissions.push(`turn ${turnNo}: ${files} uploaded file(s)`);

      if (prompt.trim() || files) {
        const { message } = buildTextMessage({
          index: messages.length,
          role: 'user',
          originalText: prompt,
          plain: true,
          extraBlocks: prompt.trim() ? notices : []
        });
        if (!prompt.trim()) message.structuredBlocks = notices;
        messages.push(message);
      } else {
        mismatches.push(`Turn ${turnNo}: prompt element present but empty.`);
      }
    } else {
      mismatches.push(`Turn ${turnNo}: no prompt element found.`);
    }

    // ── Model reply ──
    const responseEl = $(turn).find(GEMINI_SELECTORS.response).first();
    if (!responseEl.length) {
      mismatches.push(`Turn ${turnNo}: no reply element found.`);
      return;
    }
    expectedMessages++;
    const markdownEl = responseEl.find(GEMINI_SELECTORS.responseMarkdown).first();
    const contentEl = markdownEl.length ? markdownEl[0] : responseEl[0];

    const converted = htmlToBlocks($, contentEl);
    omissions.push(...converted.omissions.map((o) => `turn ${turnNo}: ${o}`));
    const raw = referenceText($, contentEl);

    if (!raw.trim() && !converted.blocks.some((b) => b.type === 'omitted')) {
      mismatches.push(`Turn ${turnNo}: reply is empty on the page.`);
      return;
    }

    const { message, formattingFallback, crossCheck } = buildHtmlMessage({
      index: messages.length,
      role: 'assistant',
      converted,
      referenceText: raw
    });
    if (formattingFallback) {
      warnings.push(`Message ${message.index + 1}: formatting could not be reproduced exactly (difference at character ${crossCheck.firstDifferenceAt}), so it is shown as plain page text.`);
    }
    messages.push(message);
  });

  if (messages.length === 0) {
    throw new AppError('UNRECOGNIZED_FORMAT', 'The Gemini share page contained no readable messages.');
  }

  const complete = mismatches.length === 0 && messages.length === expectedMessages;

  return NormalizedConversationSchema.parse({
    platform: 'gemini',
    conversationId: sourceUrl.split('/share/')[1]?.split(/[?#/]/)[0] || 'gemini-share',
    sourceUrl,
    title,
    extractedAt: new Date().toISOString(),
    messages,
    extractionStatus: complete ? 'complete' : 'partial',
    warnings,
    verification: {
      isVerified: false,
      verificationMethod: 'dom_structure_crosscheck',
      sourceMessageCount: turns.length * 2,
      extractedMessageCount: messages.length,
      exactTextMatch: warnings.length === 0,
      whitespacePreserved: false,
      unsupportedOmissions: omissions,
      mismatches,
      notes: `${turns.length} turn(s) found on the rendered page; each reply's structured text was cross-checked against the raw page text. Gemini exposes no independent source payload, so completeness is not verified.`
    }
  });
}

/**
 * Loads a public Gemini share page and extracts it.
 *
 * @param {object} validation - result of validateConversationUrl()
 * @returns {Promise<object>} Validated NormalizedConversation
 */
export async function extractGeminiConversation(validation) {
  try {
    const html = await withBrowserPage(async (page) => {
      const response = await page.goto(validation.canonicalUrl, { waitUntil: 'domcontentloaded' });
      const status = response?.status() ?? 0;
      if (status === 404) {
        throw new AppError('NOT_FOUND', 'This Gemini conversation was not found.');
      }
      if (status >= 500) {
        throw new AppError('UPSTREAM_ERROR', `Gemini returned HTTP ${status}. Please retry shortly.`);
      }

      await page
        .waitForSelector(`${GEMINI_SELECTORS.turn}, ${GEMINI_SELECTORS.invalidLink}`, { timeout: 35_000 })
        .catch(() => {
          throw new AppError('UNRECOGNIZED_FORMAT', 'The Gemini share page did not display a conversation. The page layout may have changed, or access is restricted.');
        });

      // Wait until the number of rendered replies stops changing, scrolling to
      // the end in case later turns are loaded lazily.
      let previous = -1;
      let stableRounds = 0;
      for (let i = 0; i < 20 && stableRounds < 2; i++) {
        const count = await page.locator(`${GEMINI_SELECTORS.response} ${GEMINI_SELECTORS.responseMarkdown}`).count();
        stableRounds = count === previous ? stableRounds + 1 : 0;
        previous = count;
        await page.evaluate(() => {
          const turns = document.querySelectorAll('share-turn-viewer');
          turns[turns.length - 1]?.scrollIntoView({ block: 'end' });
        });
        await page.waitForTimeout(750);
      }

      return page.content();
    }, { hostSuffixes: PLATFORM.browserHostSuffixes, timeoutMs: 75_000 });

    return parseGeminiHtml(html, validation.canonicalUrl);
  } catch (err) {
    throw normalizeUpstreamError(err, 'Gemini');
  }
}
