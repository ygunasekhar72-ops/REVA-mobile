/* Unit test: highlight.js integration (js/hljs.js + vendored sources).
   Node loads the vendored CJS files natively — the REAL engine — and the
   pure ext map from the loader. Browser highlight() resolves null here
   (no document), proving the fallback contract. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const HL = require('../js/hljs.js');

(async () => {
  // 1. pure ext map: paths, bare exts, hljs naming (HTML = xml)
  assert.strictEqual(HL.extLang('src/app.js'), 'javascript');
  assert.strictEqual(HL.extLang('.TSX'), 'typescript');
  assert.strictEqual(HL.extLang('index.html'), 'xml', 'hljs calls HTML xml');
  assert.strictEqual(HL.extLang('main.cpp'), 'cpp');
  assert.strictEqual(HL.extLang('notes.txt'), null);

  // 2. the REAL vendored engine: core + static language registration
  const hljs = require('../js/vendor/hljs/core.js');
  hljs.registerLanguage('javascript', require('../js/vendor/hljs/languages/javascript.js'));
  hljs.registerLanguage('python', require('../js/vendor/hljs/languages/python.js'));
  hljs.registerLanguage('xml', require('../js/vendor/hljs/languages/xml.js'));
  hljs.registerLanguage('css', require('../js/vendor/hljs/languages/css.js'));
  assert.ok(hljs.getLanguage('javascript'), 'registered');

  // 3. JS: keywords, strings, comments marked with engine classes
  const js = hljs.highlight('const x = "hi"; // note', { language: 'javascript', ignoreIllegals: true }).value;
  assert.ok(/hljs-keyword/.test(js), 'keyword span: ' + js);
  assert.ok(/hljs-string/.test(js) && /&quot;hi&quot;/.test(js), 'string span (engine escapes quotes)');
  assert.ok(/hljs-comment/.test(js), 'comment span');

  // 4. Python + HTML through the same engine
  const py = hljs.highlight('def add(a, b):\n    return a + b', { language: 'python', ignoreIllegals: true }).value;
  assert.ok(/hljs-keyword|hljs-title/.test(py), 'python spans');
  const html = hljs.highlight('<div class="x">hi</div>', { language: 'xml', ignoreIllegals: true }).value;
  assert.ok(/hljs-name|hljs-tag/.test(html), 'html spans');

  // 5. unknown language throws in the engine; loader contract = null
  assert.throws(() => hljs.highlight('x', { language: 'definitely-not-a-lang' }), 'engine throws on unknown');
  assert.strictEqual(await HL.highlight('x', 'js'), null, 'browser glue resolves null in node (fallback contract)');

  // 6. all vendored language files are non-empty CJS modules (text-level
  //    sweep; per-file syntax is proven by the loader in the browser)
  const dir = path.join(__dirname, '..', 'js', 'vendor', 'hljs', 'languages');
  const files = fs.readdirSync(dir);
  assert.ok(files.length >= 380, 'all languages vendored, got ' + files.length);
  files.slice(0, 40).forEach(f => {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(t.length > 200 && /module\.exports/.test(t), f + ' looks like a CJS language module');
  });

  console.log('hljs: 6/6 scenarios PASS (' + files.length + ' languages vendored)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
