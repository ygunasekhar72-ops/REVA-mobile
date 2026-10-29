/* Unit test: repo-map engine (js/repomap.js).
   Regex-fallback extraction, token-frequency reference graph, ranking with
   cross-file boosts, budgeted rendering — plus one REAL tree-sitter case
   (the JS grammar) through the same resolver contract the WebView uses. */
'use strict';
const assert = require('assert');
const path = require('path');

const REVAMAP = require('../js/repomap.js');

(async () => {
  // 1. fallback extraction: names, kinds, line numbers
  const syms = REVAMAP.extractFallback('javascript', [
    'import x from "./x.js";',
    'function computeTotal(items) { return 1; }',
    'const dbl = (n) => n * 2;',
    'class Cart {'
  ].join('\n'));
  assert.ok(syms.some(s => s.name === 'computeTotal' && s.kind === 'func' && s.line === 2), 'func line-accurate');
  assert.ok(syms.some(s => s.name === 'dbl' && s.kind === 'func'), 'arrow const');
  assert.ok(syms.some(s => s.name === 'Cart' && s.kind === 'class'), 'class');

  // 2. tokenization counts
  const freq = REVAMAP.tokenize('Cart Cart add cat');
  assert.strictEqual(freq.Cart, 2);
  assert.strictEqual(freq.add, 1);

  // 3. build (fallback resolver): cross-file references rank the hub file first
  const files = {
    'src/main.js': 'import { Cart } from "./app.js";\nconst c = new Cart();\nc.add("x");\nc.add("y");\nrenderCart(c);',
    'src/app.js': 'export function renderCart(c) { return c; }\nexport class Cart {\n  add(item) { return item; }\n}',
    'src/deep/lonely.js': 'function untouched() { return 42; }',
    'assets/logo.png': 'data:image/png;base64,AAAA',
    'readme.md': '# not code'
  };
  const map1 = await REVAMAP.build(files, null, 'lib/demo/', 2000);
  assert.ok(map1.text.indexOf('PROJECT MAP — lib/demo/') === 0, 'header with label');
  assert.ok(map1.text.indexOf('src/app.js') === 15 || map1.text.indexOf('src/app.js') > 0, 'app.js present');
  const appPos = map1.text.indexOf('src/app.js');
  const lonelyPos = map1.text.indexOf('src/deep/lonely.js');
  assert.ok(appPos >= 0 && lonelyPos >= 0 && appPos < lonelyPos, 'hub file ranks above the untouched file');
  assert.ok(map1.text.indexOf('logo.png') < 0 && map1.text.indexOf('readme.md') < 0, 'non-code files excluded');
  const map1b = await REVAMAP.build(files, null, 'lib/demo/', 2000);
  assert.strictEqual(map1b.text, map1.text, 'deterministic output');

  // 4. budget: tiny budget keeps the header + truncation note
  const map2 = await REVAMAP.build(files, null, 'lib/demo/', 120);
  assert.ok(map2.text.length <= 260, 'budget respected, got ' + map2.text.length);
  assert.ok(map2.text.indexOf('more files') > 0, 'truncation note present');

  // 5. sig: content-based (budget-independent), moves on content change
  assert.ok(map1.sig && typeof map1.sig === 'string', 'sig exists');
  const files2 = Object.assign({}, files, { 'src/app.js': files['src/app.js'] + '\nfunction extra() {}' });
  const map3 = await REVAMAP.build(files2, null, 'lib/demo/', 2000);
  assert.notStrictEqual(map1.sig, map3.sig, 'content change moves the sig');

  // 6. REAL tree-sitter resolver (same contract as the WebView's symbolsFor)
  const TreeSitter = require('../js/vendor/tree-sitter.js');
  await TreeSitter.init({ locateFile: f => path.join(__dirname, '..', 'js', 'vendor', f) });
  const jsParser = new TreeSitter();
  jsParser.setLanguage(await TreeSitter.Language.load(path.join(__dirname, '..', 'js', 'vendor', 'ts', 'tree-sitter-javascript.wasm')));
  const realResolver = (p, content) => Promise.resolve({ lang: 'javascript', symbols: require('../js/treesitter.js').extractWith(jsParser, 'javascript', content) });
  const map4 = await REVAMAP.build(files, realResolver, 'lib/demo/', 2000);
  assert.ok(map4.text.indexOf('method add (L3)') >= 0, 'AST method with real line: ' + map4.text.split('\n')[1]);
  jsParser.delete();

  console.log('repomap: 6/6 scenarios PASS');
  /* NOTE: on Windows/node-24 the process may log a libuv async-handle assert
     at teardown AFTER this line (exit 127) — a known emscripten/node-24 win
     teardown artifact; CI runs node 20 on ubuntu where the exit is clean. */
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
