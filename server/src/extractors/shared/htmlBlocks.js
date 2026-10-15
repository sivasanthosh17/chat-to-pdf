/**
 * htmlBlocks.js
 *
 * Converts a rendered message element (parsed with Cheerio) into the
 * normalized structured-block representation.
 *
 * Security: no source HTML is ever passed through. Inline formatting is
 * captured as structured "runs" ({ text, bold, italic, code, strike, href })
 * which the PDF template escapes and re-emits from its own fixed tag set.
 * Only http(s) links are kept.
 *
 * Fidelity:
 *   - Text is collapsed exactly as a browser collapses HTML whitespace in
 *     normal flow; <pre> content is copied verbatim.
 *   - Content we cannot reproduce (images, embedded media) becomes an explicit
 *     "omitted" block and is reported, never silently dropped.
 *   - KaTeX math is replaced with its LaTeX source (from the MathML
 *     annotation) because the PDF does not typeset math.
 *   - referenceText() is a separate, simpler routine (raw textContent minus
 *     hidden UI) used to cross-check that the walker lost no text.
 */

const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'button', 'svg', 'input', 'textarea', 'select',
  'mat-icon', 'gem-icon', 'gem-icon-button', 'iframe', 'object', 'embed', 'canvas', 'video', 'audio'
]);
const SKIP_CLASS_REGEX = /(^|\s)(cdk-visually-hidden|sr-only|visually-hidden|screen-reader[\w-]*)(\s|$)/;
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'table', 'blockquote',
  'hr', 'figure', 'figcaption', 'details', 'summary', 'dl', 'dt', 'dd'
]);
const MATH_SELECTOR = '.katex, .math-inline, .math-block, [data-math]';

function isElement(node) {
  return node && (node.type === 'tag' || node.type === 'script' || node.type === 'style');
}

function shouldSkip(node) {
  if (!isElement(node)) return node?.type === 'comment' || node?.type === 'cdata';
  if (SKIP_TAGS.has(node.name)) return true;
  const cls = node.attribs?.class || '';
  if (SKIP_CLASS_REGEX.test(cls)) return true;
  if (node.attribs?.['aria-hidden'] === 'true') return true;
  if (node.attribs?.hidden !== undefined) return true;
  return false;
}

function isBlockElement(node) {
  return isElement(node) && (BLOCK_TAGS.has(node.name) || node.name.includes('-'));
}

function isMathElement($, node) {
  return isElement(node) && $(node).is(MATH_SELECTOR);
}

/**
 * True when an inline-looking element wraps a content image (e.g. Gemini's
 * <a class="image-source-link"><img></a>). Such elements are walked as
 * containers so the image gets its own "omitted" block where it occurred.
 * Images drawn inside math (KaTeX uses SVG <img> for radicals) don't count.
 */
function containsContentImage($, node) {
  if (!isElement(node) || isMathElement($, node)) return false;
  return $(node).find('img').toArray().some((img) => $(img).closest(MATH_SELECTOR).length === 0);
}

/**
 * Returns the LaTeX source for a math element, or its visible text when no
 * source is available.
 */
function mathSource($, node) {
  const $node = $(node);
  const dataMath = $node.attr('data-math');
  if (dataMath) return dataMath;
  const annotation = $node.find('annotation[encoding="application/x-tex"]').first();
  if (annotation.length) return annotation.text();
  return $node.find('.katex-html').length ? $node.find('.katex-html').text() : $node.text();
}

function isDisplayMath($, node) {
  const $node = $(node);
  return $node.is('.katex-display, .math-block') || $node.parent().is('.katex-display');
}

function safeHref(href) {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// ── Inline runs ──────────────────────────────────────────────────────────────

function pushText(runs, text, fmt) {
  if (!text) return;
  runs.push({ text, ...fmt });
}

/**
 * Collects inline runs from a node tree.
 * @param {object} opts.blockSeparator - text inserted around nested block elements ('\n')
 * @param {Set<string>} [opts.exclude] - tag names to ignore entirely (e.g. nested lists)
 */
function collectInline($, node, runs, fmt, ctx, opts = {}) {
  if (shouldSkip(node)) return;

  if (node.type === 'text') {
    pushText(runs, node.data.replace(/[ \t\n\r\f]+/g, ' '), fmt);
    return;
  }
  if (!isElement(node)) return;
  if (opts.exclude?.has(node.name)) return;

  if (isMathElement($, node)) {
    pushText(runs, mathSource($, node), { ...fmt, math: true });
    ctx.hasMath = true;
    return;
  }

  switch (node.name) {
    case 'br':
      pushText(runs, '\n', {});
      return;
    case 'img':
      ctx.omissions.push('image');
      return;
    default:
      break;
  }

  const next = { ...fmt };
  if (node.name === 'b' || node.name === 'strong') next.bold = true;
  if (node.name === 'i' || node.name === 'em') next.italic = true;
  if (node.name === 's' || node.name === 'del' || node.name === 'strike') next.strike = true;
  if (node.name === 'code') next.code = true;
  if (node.name === 'a') {
    const href = safeHref(node.attribs?.href);
    if (href) next.href = href;
  }

  const separate = opts.blockSeparator && isBlockElement(node);
  if (separate) pushText(runs, opts.blockSeparator, {});
  for (const child of node.children || []) collectInline($, child, runs, next, ctx, opts);
  if (separate) pushText(runs, opts.blockSeparator, {});
}

function sameFormat(a, b) {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.code === !!b.code &&
    !!a.strike === !!b.strike && !!a.math === !!b.math && a.href === b.href;
}

/**
 * Collapses whitespace across run boundaries, trims the ends and merges
 * adjacent runs with identical formatting — mirroring browser rendering.
 */
function normalizeRuns(runs) {
  const out = [];
  for (const run of runs) {
    let text = run.text;
    const prev = out[out.length - 1];
    if (text !== '\n') {
      const prevEnd = prev ? prev.text.slice(-1) : '\n';
      if ((prevEnd === ' ' || prevEnd === '\n') && text.startsWith(' ')) text = text.slice(1);
    } else if (prev && prev.text.endsWith(' ')) {
      prev.text = prev.text.replace(/ +$/, '');
    }
    if (!text) continue;
    if (prev && sameFormat(prev, run) && text !== '\n' && prev.text !== '\n') {
      prev.text += text;
    } else {
      out.push({ ...run, text });
    }
  }

  // Collapse runs of more than two newlines (from nested block separators)
  for (let i = out.length - 1; i > 0; i--) {
    if (out[i].text === '\n' && out[i - 1].text === '\n' && out[i - 2]?.text === '\n') out.splice(i, 1);
  }

  while (out.length && (out[0].text === '\n' || !out[0].text.trim())) out.shift();
  while (out.length && (out[out.length - 1].text === '\n' || !out[out.length - 1].text.trim())) out.pop();
  if (out.length) {
    out[0].text = out[0].text.replace(/^ +/, '');
    out[out.length - 1].text = out[out.length - 1].text.replace(/ +$/, '');
  }
  return out.filter((r) => r.text).map((r) => {
    const clean = { text: r.text };
    for (const k of ['bold', 'italic', 'code', 'strike', 'math']) if (r[k]) clean[k] = true;
    if (r.href) clean.href = r.href;
    return clean;
  });
}

function runsText(runs) {
  return runs.map((r) => r.text).join('');
}

function inlineFrom($, nodes, ctx, opts = {}) {
  const runs = [];
  for (const n of nodes) collectInline($, n, runs, {}, ctx, opts);
  return normalizeRuns(runs);
}

// ── Block walker ─────────────────────────────────────────────────────────────

function handleList($, node, blocks, ctx, depth = 0, target = null) {
  const list = target || {
    type: 'list',
    ordered: node.name === 'ol',
    items: [],
    itemDepths: [],
    itemRuns: []
  };
  if (!target && list.ordered && node.attribs?.start && /^\d+$/.test(node.attribs.start)) {
    list.start = Number(node.attribs.start);
  }

  for (const li of node.children || []) {
    if (!isElement(li) || li.name !== 'li' || shouldSkip(li)) continue;
    const runs = inlineFrom($, li.children || [], ctx, { blockSeparator: '\n', exclude: new Set(['ul', 'ol']) });
    list.items.push(runsText(runs));
    list.itemDepths.push(Math.min(depth, 6));
    list.itemRuns.push(runs);
    for (const child of li.children || []) {
      if (isElement(child) && (child.name === 'ul' || child.name === 'ol') && !shouldSkip(child)) {
        handleList($, child, blocks, ctx, depth + 1, list);
      }
    }
  }

  if (!target && list.items.length) blocks.push(list);
}

function handleTable($, node, blocks, ctx) {
  const $table = $(node);
  const cellText = (cell) => runsText(inlineFrom($, cell.children || [], ctx, { blockSeparator: ' ' })).trim();

  let headers = [];
  const rows = [];
  const allRows = $table.find('tr').toArray().filter((tr) => $(tr).closest('table')[0] === node);

  allRows.forEach((tr, i) => {
    const cells = $(tr).children('th, td').toArray();
    const inHead = $(tr).parent().is('thead');
    const allTh = cells.length > 0 && cells.every((c) => c.name === 'th');
    if (headers.length === 0 && (inHead || (i === 0 && allTh))) {
      headers = cells.map(cellText);
    } else {
      rows.push(cells.map(cellText));
    }
  });

  if (headers.length || rows.length) blocks.push({ type: 'table', headers, rows });
}

function handleBlock($, node, blocks, ctx) {
  if (isMathElement($, node)) {
    const latex = mathSource($, node);
    ctx.hasMath = true;
    blocks.push({ type: 'paragraph', text: latex, runs: [{ text: latex, math: true }] });
    return;
  }

  switch (node.name) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const runs = inlineFrom($, node.children || [], ctx, { blockSeparator: ' ' });
      if (runs.length) blocks.push({ type: 'heading', level: Number(node.name[1]), text: runsText(runs), runs });
      return;
    }
    case 'ul':
    case 'ol':
      handleList($, node, blocks, ctx);
      return;
    case 'pre': {
      const $pre = $(node);
      const $code = $pre.find('code').first();
      const explicit = ($pre.attr('data-language') || $code.attr('data-language') || '').trim();
      const classes = `${$code.attr('class') || ''} ${$pre.attr('class') || ''}`;
      const langMatch = classes.match(/(?:language-|lang-)([\w+#.-]+)/);
      blocks.push({
        type: 'code',
        language: explicit ? explicit.toLowerCase() : langMatch ? langMatch[1] : 'text',
        code: ($code.length ? $code : $pre).text() // verbatim, including indentation
      });
      ctx.hasCode = true;
      return;
    }
    case 'table':
      handleTable($, node, blocks, ctx);
      ctx.hasTable = true;
      return;
    case 'blockquote': {
      const runs = inlineFrom($, node.children || [], ctx, { blockSeparator: '\n' });
      if (runs.length) blocks.push({ type: 'quote', text: runsText(runs), runs });
      return;
    }
    case 'hr':
      return;
    default:
      // Generic container (div, section, custom elements, ...)
      walkNodes($, node.children || [], blocks, ctx);
  }
}

function walkNodes($, nodes, blocks, ctx) {
  let pending = [];

  const flush = () => {
    if (pending.length === 0) return;
    const runs = normalizeRuns(pending);
    if (runs.length) blocks.push({ type: 'paragraph', text: runsText(runs), runs });
    pending = [];
  };

  for (const node of nodes) {
    if (shouldSkip(node)) continue;
    if (node.type === 'text') {
      collectInline($, node, pending, {}, ctx);
      continue;
    }
    if (!isElement(node)) continue;

    if (node.name === 'img') {
      flush();
      const alt = node.attribs?.alt || '';
      ctx.omissions.push('image'); // the alt text stays on the in-place notice below
      blocks.push({ type: 'omitted', kind: 'image', label: alt });
      continue;
    }

    if (isBlockElement(node) || (isMathElement($, node) && isDisplayMath($, node)) || containsContentImage($, node)) {
      flush();
      handleBlock($, node, blocks, ctx);
    } else {
      collectInline($, node, pending, {}, ctx);
    }
  }
  flush();
}

/**
 * Converts a rendered message element into structured blocks.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('domhandler').Element} element
 * @returns {{ blocks: object[], text: string, omissions: string[], hasMath: boolean, hasCode: boolean, hasTable: boolean }}
 */
export function htmlToBlocks($, element) {
  const ctx = { omissions: [], hasMath: false, hasCode: false, hasTable: false };
  const blocks = [];
  walkNodes($, element ? [element] : [], blocks, ctx);

  const text = blocks
    .map((b) => {
      if (b.type === 'code') return b.code;
      if (b.type === 'list') return b.items.join('\n');
      if (b.type === 'table') return [b.headers.join('\t'), ...b.rows.map((r) => r.join('\t'))].join('\n');
      if (b.type === 'omitted') return '';
      return b.text;
    })
    .filter((t) => t !== '')
    .join('\n\n');

  return { blocks, text, ...ctx };
}

/**
 * Independent reference text for an element: its raw textContent with hidden
 * UI removed and math replaced by LaTeX source. Used only for cross-checking.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('domhandler').Element} element
 * @returns {string}
 */
export function referenceText($, element) {
  const $clone = $(element).clone();
  $clone.find(MATH_SELECTOR).each((_, el) => {
    // Only replace the outermost math element
    if ($(el).parents(MATH_SELECTOR).length === 0) {
      $(el).replaceWith($('<span></span>').text(mathSource($, el))); // .text() — never parsed as HTML
    }
  });
  $clone.find('*').each((_, el) => {
    if (shouldSkip(el)) $(el).remove();
  });
  return $clone.text();
}
