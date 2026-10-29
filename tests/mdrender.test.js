/* Unit test: chat markdown + diff math (js/mdrender.js over the vendored
   markdown-it and jsdiff UMD bundles — the REAL engines, required natively).
   Security case included: raw HTML in model output must never pass through. */
'use strict';
const assert = require('assert');

const MarkdownIt = require('../js/vendor/md/markdown-it.js');
const Diff = require('../js/vendor/diff/jsdiff.js');
const MDRENDER = require('../js/mdrender.js');

function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function hl(str, lang) { return esc(str); } // neutral stand-in for the regex painter

const md = MDRENDER.createInstance(MarkdownIt, esc, hl);

(async () => {
  // 1. real markdown: headings, bold, lists, inline code
  const html = md.render('# Title\n\n**bold** and `code`\n\n- one\n- two');
  assert.ok(html.includes('<h1>Title</h1>'), 'heading');
  assert.ok(html.includes('<strong>bold</strong>'), 'bold');
  assert.ok(html.includes('<code>code</code>'), 'inline code');
  assert.ok(html.includes('<li>one</li>'), 'list');

  // 2. SECURITY: raw HTML in model output never passes through
  const xss = md.render('hello <script>alert(1)</script> <img src=x onerror=alert(2)>');
  assert.ok(!/<script/.test(xss) && !/<img/.test(xss), 'raw HTML neutralized: ' + xss);
  assert.ok(xss.includes('&lt;script&gt;'), 'escaped as text');

  // 3. fence rule: msgcode + language class; long code collapses into a card
  const short = md.render('```js\nconst a = 1;\n```');
  assert.ok(short.includes('pre class="msgcode"') && short.includes('language-js'), 'fence → msgcode');
  const long = md.render('```python\n' + Array.from({ length: 20 }, (_, i) => 'x' + i).join('\n') + '\n```');
  assert.ok(long.includes('details class="codecard"') && long.includes('20 lines'), 'long fence → codecard');

  // 4. real diff math through jsdiff
  const parts = Diff.diffLines('line1\nline2\nline3\n', 'line1\nlineX\nline3\nline4\n');
  const added = parts.filter(p => p.added).reduce((n, p) => n + p.count, 0);
  const removed = parts.filter(p => p.removed).reduce((n, p) => n + p.count, 0);
  assert.strictEqual(added, 2, 'added lines (lineX, line4)');
  assert.strictEqual(removed, 1, 'removed lines (line2)');

  // 5. node fallback contract: browser-glue render() resolves null without window
  assert.strictEqual(MDRENDER.render('# x'), null, 'render() null in node → util.js keeps its fallback');

  // 6. untouched HTML never reaches markdown-it's parser in fences either
  const dirty = md.render('```\n<b>not bold</b>\n```');
  assert.ok(dirty.includes('&lt;b&gt;'), 'fence content escaped by the painter');

  console.log('mdrender: 6/6 scenarios PASS (markdown-it 14.1.0 + jsdiff 5.2.0)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
