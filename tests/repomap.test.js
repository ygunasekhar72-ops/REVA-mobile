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

  // 4. tight budget: degradation squeezes every path in — no truncation note
  const files4 = Object.assign({}, files);
  for (let g = 1; g <= 6; g++) files4['src/gen' + g + '.js'] = 'function genFn' + g + '() { return ' + g + '; }';
  const map2 = await REVAMAP.build(files4, null, 'lib/demo/', 400);
  assert.ok(map2.text.indexOf('src/gen6.js') > 0, 'degradation fits paths a flat cut would drop');
  assert.ok(map2.text.indexOf('more files') < 0, 'everything fit — no truncation note');

  // 4b. hard truncation: below path-only space the map says so honestly
  const map2b = await REVAMAP.build(files4, null, 'lib/demo/', 200);
  assert.ok(map2b.text.indexOf('more files') > 0, 'truncation note present when even paths overflow');
  assert.ok(map2b.text.length <= 300, 'budget respected, got ' + map2b.text.length);

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

  // 7. budget scaling ladder: context window (K tokens) → map budget (chars)
  assert.strictEqual(REVAMAP.budgetFor(4), 800, '8K-class model');
  assert.strictEqual(REVAMAP.budgetFor(8), 800, '8K boundary');
  assert.strictEqual(REVAMAP.budgetFor(16), 1100, '16K');
  assert.strictEqual(REVAMAP.budgetFor(32), 1400, '32K = the historical default');
  assert.strictEqual(REVAMAP.budgetFor(64), 2100, '64K');
  assert.strictEqual(REVAMAP.budgetFor(128), 3000, '128K');
  assert.strictEqual(REVAMAP.budgetFor(256), 4200, '256K');
  assert.strictEqual(REVAMAP.budgetFor(1000), 5200, '1M caps at the ceiling');
  assert.strictEqual(REVAMAP.budgetFor(0), 1400, 'unknown context → default band');
  assert.strictEqual(REVAMAP.budgetFor(undefined), 1400, 'missing context → default band');

  // 8. big-window maps carry full outlines; tight ones degrade, not vanish
  const big = await REVAMAP.build(files, null, 'lib/demo/', 3000);
  assert.ok(big.text.indexOf('(L') >= 0, 'big budget renders line-numbered outlines');
  const tight = await REVAMAP.build(files, null, 'lib/demo/', 200);
  assert.ok(tight.text.indexOf('src/app.js') > 0, 'hub path still present under pressure');
  assert.ok(tight.text.length < big.text.length, 'tight map is genuinely smaller');

  console.log('repomap: 8/8 scenarios PASS');
  /* NOTE: on Windows/node-24 the process may log a libuv async-handle assert
     at teardown AFTER this line (exit 127) — a known emscripten/node-24 win
     teardown artifact; CI runs node 20 on ubuntu where the exit is clean. */
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
