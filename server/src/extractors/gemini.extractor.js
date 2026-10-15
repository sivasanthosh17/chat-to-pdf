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
import { plural, countPhrases } from '../utils/wording.js';

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
  responseMarkdown: '.markdown',
  codeBlock: 'code-block',
  codeDecoration: '.code-block-decoration'
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
 * Gemini code blocks (verified Oct 2026):
 *   code-block > … > div.code-block-decoration > span "Python" + Copy/Download buttons
 *                  > pre > code.code-container (no language class)
 * The header label is UI chrome, not message text: move it onto the <pre> as
 * its language and drop the header, before both the block walker and the
 * reference-text cross-check run.
 */
function normalizeCodeBlocks($) {
  $(GEMINI_SELECTORS.codeBlock).each((_, block) => {
    const $block = $(block);
    const $decoration = $block.find(GEMINI_SELECTORS.codeDecoration).first();
    const label = $decoration.children('span').first().text().trim();
    if (label) $block.find('pre').first().attr('data-language', label);
    $decoration.remove();
  });
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

  normalizeCodeBlocks($);

  const turns = $(GEMINI_SELECTORS.turn).toArray();
  if (turns.length === 0) {
    throw new AppError('UNRECOGNIZED_FORMAT', 'No conversation turns were found on the Gemini share page.');
  }

  const title = $(GEMINI_SELECTORS.title).first().text().trim() || 'Gemini Conversation';
  const messages = [];
  const warnings = [];
  const mismatches = [];
  const omissionCounts = {};
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
      if (files) omissionCounts['uploaded file'] = (omissionCounts['uploaded file'] || 0) + files;

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
        mismatches.push(`Your message in exchange ${turnNo} appears empty on the share page.`);
      }
    } else {
      mismatches.push(`Your message in exchange ${turnNo} could not be found on the share page.`);
    }

    // ── Model reply ──
    const responseEl = $(turn).find(GEMINI_SELECTORS.response).first();
    if (!responseEl.length) {
      mismatches.push(`Gemini's reply in exchange ${turnNo} could not be found on the share page.`);
      return;
    }
    expectedMessages++;
    const markdownEl = responseEl.find(GEMINI_SELECTORS.responseMarkdown).first();
    const contentEl = markdownEl.length ? markdownEl[0] : responseEl[0];

    const converted = htmlToBlocks($, contentEl);
    for (const kind of converted.omissions) omissionCounts[kind] = (omissionCounts[kind] || 0) + 1;
    const raw = referenceText($, contentEl);

    if (!raw.trim() && !converted.blocks.some((b) => b.type === 'omitted')) {
      mismatches.push(`Gemini's reply in exchange ${turnNo} appears empty on the share page.`);
      return;
    }

    const { message, formattingFallback } = buildHtmlMessage({
      index: messages.length,
      role: 'assistant',
      converted,
      referenceText: raw
    });
    if (formattingFallback) {
      warnings.push(`Message ${message.index + 1} is shown as plain text because its formatting could not be reproduced exactly. The words are unchanged.`);
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
      unsupportedOmissions: countPhrases(omissionCounts),
      mismatches,
      notes: `Read from the share page as displayed: ${plural(turns.length, 'exchange')}, with every reply's text checked against the page.`
    }
  });
}

/**
 * Loads a public Gemini share page and extracts it.
 *
 * @param {object} validation - result of validateConversationUrl()
 * @param {{ signal?: AbortSignal }} [options] - aborting stops the browser job
 * @returns {Promise<object>} Validated NormalizedConversation
 */
export async function extractGeminiConversation(validation, { signal } = {}) {
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
    }, { hostSuffixes: PLATFORM.browserHostSuffixes, timeoutMs: 75_000, signal });

    return parseGeminiHtml(html, validation.canonicalUrl);
  } catch (err) {
    throw normalizeUpstreamError(err, 'Gemini');
  }
}
