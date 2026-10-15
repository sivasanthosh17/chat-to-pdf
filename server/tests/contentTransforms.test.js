/**
 * Content transformation tests: markdown parsing, HTML → blocks, and the PDF
 * template's escaping / formatting rules.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { parseStructuredBlocks, markdownToComparableText, containsMath } from '../src/extractors/shared/markdown.js';
import { htmlToBlocks, referenceText } from '../src/extractors/shared/htmlBlocks.js';
import { blocksToPlainText, compareCompact } from '../src/extractors/shared/textCompare.js';
import { renderInlineMarkdown, renderBlock, renderRuns, buildConversationHtml } from '../src/templates/conversation.template.js';
import { verifyConversation } from '../src/verification/verification.service.js';
import { makeConversation } from './helpers.js';

// ── Markdown ─────────────────────────────────────────────────────────────────

test('markdown: blocks reproduce every content character of the source', () => {
  const samples = [
    '# H1\n## 2. Numbered heading\nText **bold** and `code`.',
    '- a\n  - nested\n* b\n+ c\n\n1. one\n2. two',
    '> quote line 1\n> quote line 2',
    '| A | B |\n|:---|---:|\n| 1 | 2 |\n| x \\| y | z |',
    '```\nplain fence\n```\n\n```c++\n\tint x;\n```',
    'horizontal\n\n---\n\nrule',
    'Unicode: தமிழ் 中文 العربية 😀 ∑ x²'
  ];
  for (const text of samples) {
    const cmp = compareCompact(markdownToComparableText(text), blocksToPlainText(parseStructuredBlocks(text)));
    assert.equal(cmp.match, true, `content mismatch for: ${JSON.stringify(text)}`);
  }
});

test('markdown: tables, list start and depth are parsed', () => {
  const blocks = parseStructuredBlocks('5. five\n6. six\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
  assert.deepEqual(blocks[0], { type: 'list', ordered: true, start: 5, items: ['five', 'six'], itemDepths: [0, 0] });
  assert.deepEqual(blocks[1], { type: 'table', headers: ['A', 'B'], rows: [['1', '2']] });
});

test('markdown: code fence content and indentation are verbatim', () => {
  const code = 'def f():\n\treturn  "x"   \n    # trailing spaces kept   \n';
  const [block] = parseStructuredBlocks('```python\n' + code + '```');
  assert.equal(block.code, code);
});

test('containsMath detects LaTeX but not plain currency', () => {
  assert.equal(containsMath('Costs $5 and $10 today'), false);
  assert.equal(containsMath('Area is $\\pi r^2$'), true);
  assert.equal(containsMath('\\(a+b\\)'), true);
  assert.equal(containsMath('$$\\int_0^1 x\\,dx$$'), true);
});

// ── HTML → blocks ────────────────────────────────────────────────────────────

function convert(html) {
  const $ = cheerio.load(`<div id="root">${html}</div>`);
  const el = $('#root')[0];
  return { ...htmlToBlocks($, el), reference: referenceText($, el) };
}

test('htmlBlocks: whitespace collapses like a browser; <pre> stays verbatim', () => {
  const r = convert('<p>  a\n   b  <b> c </b> d </p><pre><code>  x\n\ty  </code></pre>');
  assert.equal(r.blocks[0].text, 'a b c d');
  assert.equal(r.blocks[1].code, '  x\n\ty  ');
});

test('htmlBlocks: hidden UI, buttons, scripts and styles are excluded from both views', () => {
  const r = convert('<p>Visible</p><span class="cdk-visually-hidden">Hidden</span><button>Copy</button><script>x()</script><style>p{}</style><p aria-hidden="true">aria</p>');
  assert.equal(blocksToPlainText(r.blocks), 'Visible');
  assert.equal(r.reference.trim(), 'Visible');
});

test('htmlBlocks: only http(s) links survive', () => {
  const r = convert('<p><a href="https://ok.example/">ok</a> <a href="javascript:alert(1)">js</a> <a href="data:text/html,x">data</a></p>');
  const hrefs = r.blocks[0].runs.filter((x) => x.href).map((x) => x.href);
  assert.deepEqual(hrefs, ['https://ok.example/']);
  assert.equal(r.blocks[0].text, 'ok js data');
});

test('htmlBlocks: walker output matches the independent reference text', () => {
  const html = '<h2>T</h2><p>a <i>b</i></p><ul><li>x<ul><li>y</li></ul></li></ul><table><tr><th>h</th></tr><tr><td>c</td></tr></table><blockquote><p>q</p></blockquote>';
  const r = convert(html);
  assert.equal(compareCompact(r.reference, blocksToPlainText(r.blocks)).match, true);
});

// ── Template ─────────────────────────────────────────────────────────────────

test('template: HTML in conversation text is escaped, never rendered', () => {
  const html = renderInlineMarkdown('<img src=x onerror=alert(1)> & "quotes"');
  assert.equal(html, '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;');
  assert.ok(!renderBlock({ type: 'paragraph', text: '<script>alert(1)</script>', preformatted: true }).includes('<script>'));
});

test('template: only http(s) markdown links become anchors', () => {
  assert.equal(renderInlineMarkdown('[ok](https://a.example/x?y=1&z=2)'), '<a href="https://a.example/x?y=1&amp;z=2">ok</a>');
  assert.equal(renderInlineMarkdown('[bad](javascript:alert(1))'), '[bad](javascript:alert(1))');
  assert.equal(renderInlineMarkdown('see https://a.example/p.'), 'see <a href="https://a.example/p">https://a.example/p</a>.');
});

test('template: asterisks used as content are not swallowed as emphasis', () => {
  assert.equal(renderInlineMarkdown('2*3*4 = 24'), '2*3*4 = 24');
  assert.equal(renderInlineMarkdown('a * b * c'), 'a * b * c');
  assert.equal(renderInlineMarkdown('snake_case_name'), 'snake_case_name');
  assert.equal(renderInlineMarkdown('**bold** and *it*'), '<strong>bold</strong> and <em>it</em>');
  assert.equal(renderInlineMarkdown('`**not bold**`'), '<code class="inline-code">**not bold**</code>');
});

test('template: runs render with escaping and safe links only', () => {
  const html = renderRuns([{ text: '<b>', bold: true }, { text: 'x', href: 'javascript:alert(1)' }, { text: 'y', href: 'https://ok.example/' }]);
  assert.equal(html, '<strong>&lt;b&gt;</strong>x<a href="https://ok.example/">y</a>');
});

test('template: ordered list start number and omitted notices are rendered', () => {
  assert.match(renderBlock({ type: 'list', ordered: true, start: 3, items: ['c'] }), /<ol class="msg-list" start="3">/);
  assert.match(renderBlock({ type: 'omitted', kind: 'image', label: 'chart' }), /Not included in this PDF: image — chart/);
});

test('template: document has a restrictive CSP and no scripts', () => {
  const conv = makeConversation();
  conv.messages[1].originalText = conv.messages[1].structuredBlocks[0].text = '</style><script>alert(1)</script>';
  const html = buildConversationHtml(conv, verifyConversation(conv));
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  assert.ok(!/<script/i.test(html));
});

test('template: summary box (when requested) reflects each grade honestly', () => {
  const conv = makeConversation();
  for (const [grade, label] of [['verified', 'Verified'], ['unverified', 'Unverified'], ['incomplete', 'Incomplete'], ['verified_with_warnings', 'Verified with warnings']]) {
    const html = buildConversationHtml(conv, { grade, warnings: [], errors: [], notes: [], showSummary: true });
    assert.ok(html.includes(`Content verification: <strong>${label}</strong>`), grade);
  }
});

test('template: summary box is off by default, but the INCOMPLETE warning always prints', () => {
  const conv = makeConversation();
  const plain = buildConversationHtml(conv, { grade: 'verified', warnings: ['w'], errors: [], notes: ['n'] });
  assert.ok(!plain.includes('Content verification'));

  const partial = buildConversationHtml({ ...conv, extractionStatus: 'partial' }, { grade: 'incomplete', warnings: [], errors: [], notes: [] });
  assert.ok(partial.includes('INCOMPLETE — this PDF may be missing messages from the original conversation.'));
  assert.ok(!partial.includes('Content verification'));
});
