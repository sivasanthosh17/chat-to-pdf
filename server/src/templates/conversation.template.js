/**
 * conversation.template.js
 *
 * Builds a complete self-contained HTML string from a NormalizedConversation
 * object. This HTML is handed to Playwright's page.setContent() and then
 * printed to PDF — it never contains or executes scripts.
 *
 * Security rules:
 *   - All conversation text is escaped via escapeHtml() before insertion.
 *   - No source HTML is passed through. Formatting comes either from markdown
 *     syntax (interpreted here into a fixed tag set) or from structured inline
 *     runs ({ text, bold, italic, code, href }) produced by the extractors.
 *   - Links are emitted only for http(s) URLs.
 *   - CSS is entirely self-contained so no external resources are needed.
 *
 * Content fidelity rules:
 *   - structuredBlocks carry the complete message text; the verification
 *     service blocks PDF generation if they do not.
 *   - Preformatted paragraphs (user prompts, fallbacks) are rendered with
 *     whitespace preserved and no markdown interpretation.
 *   - Content that cannot be reproduced is shown as a visible "not included"
 *     notice where it occurred.
 *   - Mathematical expressions are rendered verbatim as LaTeX source.
 */

const PLATFORM_LABELS = { chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude' };

/**
 * Escapes a string for safe insertion into HTML text content or attributes.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeHref(url) {
  return /^https?:\/\/[^\s]+$/i.test(url);
}

/**
 * Renders inline markdown to safe HTML.
 * Handles: `inline code`, [links](https://…), bare https:// URLs, **bold**,
 * *italic* / _italic_, ~~strikethrough~~.
 *
 * Text is HTML-escaped first; code spans and links are swapped for
 * placeholders so their contents are never re-interpreted as formatting.
 * @param {string} str
 * @returns {string}
 */
export function renderInlineMarkdown(str) {
  if (typeof str !== 'string') return '';
  const tokens = [];
  const stash = (html) => `\u0000${tokens.push(html) - 1}\u0000`;

  let s = escapeHtml(str);

  // 1. Inline code
  s = s.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code class="inline-code">${code}</code>`));

  // 2. Markdown links [text](http…)
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, text, url) =>
    isSafeHref(url) ? stash(`<a href="${url}">${text}</a>`) : m
  );

  // 3. Bare URLs (trailing punctuation stays outside the link)
  s = s.replace(/(^|[\s(>])(https?:\/\/[^\s<\u0000]+[^\s<\u0000.,;:!?)\]'"])/g, (m, pre, url) =>
    `${pre}${stash(`<a href="${url}">${url}</a>`)}`
  );

  // 4. Emphasis — delimiters must hug non-space text so "a * b * c" and
  //    "2*3*4" keep their asterisks
  s = s.replace(/\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(?=\S)(.+?)(?<=\S)__/g, '<strong>$1</strong>');
  s = s.replace(/(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])/g, '<em>$1</em>');
  s = s.replace(/(?<![\w_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\w_])/g, '<em>$1</em>');
  s = s.replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '<del>$1</del>');

  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
}

/**
 * Renders structured inline runs (from rendered DOM) to safe HTML.
 * @param {Array<object>} runs
 * @returns {string}
 */
export function renderRuns(runs) {
  return (runs || [])
    .map((run) => {
      let html = escapeHtml(run.text).replace(/\n/g, '<br>');
      if (run.math) html = `<span class="math-src">${html}</span>`;
      if (run.code) html = `<code class="inline-code">${html}</code>`;
      if (run.bold) html = `<strong>${html}</strong>`;
      if (run.italic) html = `<em>${html}</em>`;
      if (run.strike) html = `<del>${html}</del>`;
      if (run.href && isSafeHref(run.href)) html = `<a href="${escapeHtml(run.href)}">${html}</a>`;
      return html;
    })
    .join('');
}

function renderText(text, runs) {
  return runs ? renderRuns(runs) : renderInlineMarkdown(text).replace(/\n/g, '<br>');
}

function renderList(block) {
  const depths = block.itemDepths || [];
  const minDepth = depths.length ? Math.min(...depths) : 0;
  const items = (block.items || [])
    .map((item, i) => {
      const depth = Math.max(0, (depths[i] ?? minDepth) - minDepth);
      const body = block.itemRuns?.[i] ? renderRuns(block.itemRuns[i]) : renderInlineMarkdown(item);
      return `<li class="depth-${Math.min(depth, 6)}">${body}</li>`;
    })
    .join('\n');
  const tag = block.ordered ? 'ol' : 'ul';
  const start = block.ordered && Number.isInteger(block.start) && block.start !== 1 ? ` start="${block.start}"` : '';
  return `<${tag} class="msg-list"${start}>${items}</${tag}>`;
}

/**
 * Renders a single ContentBlock to an HTML snippet.
 * @param {object} block
 * @returns {string}
 */
export function renderBlock(block) {
  switch (block.type) {
    case 'paragraph':
      if (block.preformatted) {
        return `<p class="msg-paragraph preformatted">${escapeHtml(block.text)}</p>`;
      }
      return `<p class="msg-paragraph">${renderText(block.text, block.runs)}</p>`;

    case 'heading': {
      const level = Math.min(Math.max(block.level, 1), 6);
      return `<h${level} class="msg-heading msg-h${level}">${renderText(block.text, block.runs)}</h${level}>`;
    }

    case 'code':
      return `<div class="code-block">
  <div class="code-lang" data-nocompare>${escapeHtml(block.language || 'text')}</div>
  <pre><code>${escapeHtml(block.code)}</code></pre>
</div>`;

    case 'list':
      return renderList(block);

    case 'table': {
      const cell = (text) => renderInlineMarkdown(text);
      const headers = (block.headers || []).map((h) => `<th>${cell(h)}</th>`).join('');
      const rows = (block.rows || [])
        .map((row) => `<tr>${row.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`)
        .join('\n');
      return `<div class="table-wrapper">
  <table>
    ${headers ? `<thead><tr>${headers}</tr></thead>` : ''}
    <tbody>${rows}</tbody>
  </table>
</div>`;
    }

    case 'quote':
      return `<blockquote class="msg-quote">${renderText(block.text, block.runs)}</blockquote>`;

    case 'omitted':
      return `<div class="omitted-notice" data-nocompare>Not included in this PDF: ${escapeHtml(block.kind)}${
        block.label ? ` — ${escapeHtml(block.label)}` : ''
      }</div>`;

    default:
      return `<p class="msg-paragraph preformatted">${escapeHtml(String(block.text ?? ''))}</p>`;
  }
}

/**
 * Renders a single message turn to HTML.
 * @param {object} message  - NormalizedConversation message
 * @param {number} index    - display index (1-based)
 * @param {string} platform
 * @returns {string}
 */
function renderMessage(message, index, platform) {
  const roleLabel = message.role === 'user' ? 'You' : PLATFORM_LABELS[platform] || 'Assistant';
  const roleClass = message.role === 'user' ? 'role-user' : 'role-assistant';

  const blocks = message.structuredBlocks?.length
    ? message.structuredBlocks
    : [{ type: 'paragraph', text: message.originalText, preformatted: true }];
  const bodyHtml = blocks.map(renderBlock).join('\n');

  const warningHtml = message.hasMath
    ? '<div class="msg-warning" data-nocompare>Mathematical expressions are shown as LaTeX source (not typeset).</div>'
    : '';

  return `<div class="message-turn ${roleClass}" id="msg-${index}" data-message-index="${index - 1}">
  <div class="message-header" data-nocompare>
    <span class="role-badge">${escapeHtml(roleLabel)}</span>
    <span class="msg-index">#${index}</span>
  </div>
  <div class="message-body">
    ${bodyHtml}
    ${warningHtml}
  </div>
</div>`;
}

// `text` explains the grade only where the extractor's own note does not
// (verified notes already say how the check was done).
const GRADE_INFO = {
  verified: { cls: 'banner-verified', label: 'Verified', text: '' },
  verified_with_warnings: { cls: 'banner-warning', label: 'Verified with warnings', text: '' },
  unverified: {
    cls: 'banner-unverified',
    label: 'Unverified',
    text: 'The text is copied exactly as the share page shows it, but there is no second copy to check it against, so it cannot be confirmed that nothing is missing.'
  },
  incomplete: { cls: 'banner-incomplete', label: 'Incomplete', text: 'Some messages may be missing from this PDF.' },
  failed: { cls: 'banner-failed', label: 'Verification failed', text: '' }
};

/**
 * Builds the first-page "About this PDF" box from the VerificationReport:
 *   grade · how it was checked · things to note · the user's download choices
 * @param {object} report
 * @returns {string}
 */
function renderVerificationBanner(report) {
  const info = GRADE_INFO[report.grade] || GRADE_INFO.unverified;
  const list = (items, cls = '') =>
    items.length ? `<ul class="banner-list ${cls}">${items.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : '';
  const paragraph = [info.text, ...(report.notes || [])].filter(Boolean).join(' ');
  const warnings = report.warnings || [];
  const adjustments = report.adjustments || [];

  return `<div class="verification-banner ${info.cls}">
  <div class="banner-title">Content verification: <strong>${escapeHtml(info.label)}</strong></div>
  ${paragraph ? `<p class="banner-text">${escapeHtml(paragraph)}</p>` : ''}
  ${warnings.length ? `<div class="banner-label">Please note:</div>${list(warnings)}` : ''}
  ${list(report.errors || [], 'banner-errors')}
  ${adjustments.length
    ? `<div class="banner-section"><span class="banner-label">Your download choice:</span> ${adjustments.map(escapeHtml).join(' ')}</div>`
    : ''}
</div>`;
}

/**
 * Generates the full self-contained HTML document for the PDF.
 *
 * @param {object} conversation  - NormalizedConversation
 * @param {object} report        - VerificationReport from verification.service.js
 * @returns {string}             - Complete HTML string ready for Playwright
 */
export function buildConversationHtml(conversation, report) {
  const { platform, title, sourceUrl, extractedAt, messages } = conversation;

  const platformLabel = PLATFORM_LABELS[platform] || platform;
  const extractedDate = new Date(extractedAt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
  }) + ' UTC';

  // The summary box is a download option (off by default); the INCOMPLETE
  // warning below and in-place "not included" notices always print.
  const bannerHtml = report.showSummary ? renderVerificationBanner(report) : '';
  const messagesHtml = messages.map((msg, i) => renderMessage(msg, i + 1, platform)).join('\n\n');

  const incompleteBanner = conversation.extractionStatus === 'partial' || report.grade === 'incomplete'
    ? `<div class="incomplete-banner">INCOMPLETE — this PDF may be missing messages${report.showSummary ? '. See the details above.' : ' from the original conversation.'}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${escapeHtml(title || 'AI Conversation')}</title>
<style>
  /* ── Reset ── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── Typography ── */
  body {
    font-family: 'Segoe UI', 'Noto Sans', 'Helvetica Neue', Arial, 'Noto Sans CJK SC', 'Noto Sans Devanagari',
      'Noto Sans Tamil', 'Noto Sans Arabic', 'Noto Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #1a1a2e;
    background: #fff;
  }

  @page { size: A4; margin: 20mm 18mm 22mm 18mm; }
  @page :first { margin-top: 15mm; }

  a { color: #3949ab; text-decoration: underline; overflow-wrap: anywhere; }

  /* ── Cover / Header ── */
  .cover { border-bottom: 3px solid #4361ee; padding-bottom: 14px; margin-bottom: 20px; }
  .cover-platform {
    display: inline-block; background: #4361ee; color: #fff; font-size: 8pt; font-weight: 700;
    letter-spacing: 1.5px; text-transform: uppercase; padding: 3px 10px; border-radius: 20px; margin-bottom: 8px;
  }
  .cover-title { font-size: 18pt; font-weight: 700; line-height: 1.2; margin-bottom: 6px; overflow-wrap: anywhere; }
  .cover-meta { font-size: 8.5pt; color: #555; }
  .cover-meta div { margin-top: 2px; overflow-wrap: anywhere; }

  /* ── Verification banner ── */
  .verification-banner { border-radius: 6px; padding: 10px 14px; margin-bottom: 18px; font-size: 8.5pt; }
  .banner-verified   { background: #e8f5e9; border-left: 4px solid #2e7d32; color: #1b5e20; }
  .banner-warning    { background: #fff8e1; border-left: 4px solid #f57f17; color: #4e3400; }
  .banner-unverified { background: #eef2ff; border-left: 4px solid #3949ab; color: #1a237e; }
  .banner-incomplete { background: #fff3e0; border-left: 4px solid #ef6c00; color: #bf360c; }
  .banner-failed     { background: #fce4ec; border-left: 4px solid #b71c1c; color: #7f0000; }
  .banner-title { font-weight: 600; margin-bottom: 3px; font-size: 9.5pt; }
  .banner-text { margin-bottom: 4px; line-height: 1.5; }
  .banner-label { font-weight: 600; margin-top: 6px; }
  .banner-list { padding-left: 18px; margin-top: 2px; }
  .banner-list li { margin-bottom: 2px; overflow-wrap: anywhere; }
  .banner-errors li { color: #b71c1c; }
  .banner-section { margin-top: 8px; padding-top: 7px; border-top: 1px solid rgba(0, 0, 0, 0.12); }
  .banner-section .banner-label { margin-top: 0; }

  .incomplete-banner {
    background: #fff3e0; border: 2px solid #ef6c00; border-radius: 6px; padding: 10px 14px;
    font-weight: 700; font-size: 10pt; color: #bf360c; margin-bottom: 16px;
  }

  /* ── Message turns ── long messages may break across pages */
  .message-turn { margin-bottom: 16px; border: 1px solid #e0e0e0; border-radius: 8px; }
  .message-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 5px 12px; font-size: 8.5pt; font-weight: 700;
    border-radius: 8px 8px 0 0; break-after: avoid; page-break-after: avoid;
  }
  .role-user .message-header { background: #e8eaf6; }
  .role-assistant .message-header { background: #e0f2f1; }
  .role-badge {
    border-radius: 12px; padding: 2px 9px; font-size: 7.5pt; font-weight: 800;
    letter-spacing: 0.5px; text-transform: uppercase; color: #fff;
  }
  .role-user .role-badge { background: #3949ab; }
  .role-assistant .role-badge { background: #00695c; }
  .msg-index { color: #888; font-weight: 400; }

  .message-body { padding: 10px 14px; overflow-wrap: anywhere; }

  /* ── Paragraph ── */
  .msg-paragraph { margin-bottom: 8px; }
  .msg-paragraph:last-child { margin-bottom: 0; }
  .preformatted { white-space: pre-wrap; }
  .inline-code {
    font-family: 'Cascadia Code', 'Consolas', 'DejaVu Sans Mono', 'Noto Sans Mono', monospace;
    font-size: 0.9em; background: #f1f1f4; border-radius: 3px; padding: 0 3px;
  }
  .math-src { font-family: 'Cascadia Code', 'Consolas', 'DejaVu Sans Mono', monospace; font-size: 0.92em; color: #4a148c; }

  /* ── Headings inside messages ── */
  .msg-heading { margin: 10px 0 4px; break-after: avoid; page-break-after: avoid; }
  .msg-h1 { font-size: 13pt; }
  .msg-h2 { font-size: 12pt; }
  .msg-h3 { font-size: 11pt; }
  .msg-h4, .msg-h5, .msg-h6 { font-size: 10pt; }

  /* ── Code blocks ── wrap instead of clipping long lines */
  .code-block { background: #1e1e2e; border-radius: 5px; margin: 8px 0; }
  .code-lang {
    background: #2a2a3e; color: #a0a0c0; font-size: 7.5pt; padding: 3px 10px;
    border-radius: 5px 5px 0 0; font-family: monospace; letter-spacing: 0.5px; text-transform: uppercase;
  }
  pre { margin: 0; padding: 10px 12px; }
  pre code {
    font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'DejaVu Sans Mono', 'Noto Sans Mono', monospace;
    font-size: 8.3pt; color: #cdd6f4; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4;
  }

  /* ── Lists ── */
  .msg-list { padding-left: 22px; margin: 6px 0; }
  .msg-list li { margin-bottom: 3px; }
  .msg-list li.depth-1 { margin-left: 18px; }
  .msg-list li.depth-2 { margin-left: 36px; }
  .msg-list li.depth-3 { margin-left: 54px; }
  .msg-list li.depth-4, .msg-list li.depth-5, .msg-list li.depth-6 { margin-left: 72px; }

  /* ── Tables ── rows never split; header repeats on each page */
  .table-wrapper { margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 8.8pt; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  th { background: #f5f5f5; font-weight: 700; }
  tr:nth-child(even) td { background: #fafafa; }

  /* ── Blockquote ── */
  .msg-quote { border-left: 3px solid #9e9e9e; padding-left: 10px; color: #444; margin: 6px 0; }

  /* ── Notices ── */
  .omitted-notice {
    border: 1px dashed #b0b0b0; background: #f7f7f9; color: #555; font-size: 8pt;
    padding: 4px 9px; margin: 6px 0; border-radius: 4px;
  }
  .msg-warning {
    background: #fff8e1; border-left: 3px solid #ffc107; padding: 4px 9px;
    font-size: 8pt; color: #5d4037; margin-top: 8px;
  }

  /* ── Footer ── */
  .pdf-footer {
    margin-top: 28px; padding-top: 10px; border-top: 1px solid #e0e0e0;
    font-size: 7.5pt; color: #999; text-align: center;
  }
</style>
</head>
<body>
<div class="cover" data-nocompare>
  <div class="cover-platform">${escapeHtml(platformLabel)}</div>
  <div class="cover-title">${escapeHtml(title || 'AI Conversation')}</div>
  <div class="cover-meta">
    <div>Extracted: ${escapeHtml(extractedDate)} · ${messages.length} message${messages.length === 1 ? '' : 's'}</div>
    <div>Source: ${isSafeHref(sourceUrl) ? `<a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a>` : escapeHtml(sourceUrl)}</div>
  </div>
</div>

<div data-nocompare>
${bannerHtml}
${incompleteBanner}
</div>

<div class="conversation">
${messagesHtml}
</div>

<div class="pdf-footer" data-nocompare>
  Generated by Chat-to-PDF Converter · Message text copied verbatim, no AI rewriting · ${escapeHtml(extractedDate)}
</div>
</body>
</html>`;
}
