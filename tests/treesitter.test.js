/* Unit test: tree-sitter AST engine (js/treesitter.js).
   Runs the REAL vendored parsers (web-tree-sitter WASM) in node against the
   same extractWith() code the WebView uses — regex fallback only for
   languages without a grammar. */
'use strict';
const assert = require('assert');
const path = require('path');

/* NOTE: tree-sitter.js must be required in a CLEAN node env — it detects
   the runtime and takes its fs/node branch; stubbing window first would
   send it down the browser branch (window.document undefined here). */
const TreeSitter = require('../js/vendor/tree-sitter.js');
const REVATS = require('../js/treesitter.js');
const VENDOR = path.join(__dirname, '..', 'js', 'vendor');

(async () => {
  // 1. language mapping covers the vendored set
  assert.strictEqual(REVATS.extLang('js'), 'javascript');
  assert.strictEqual(REVATS.extLang('.TSX'), 'tsx');
  assert.strictEqual(REVATS.extLang('rs'), 'rust');
  assert.strictEqual(REVATS.extLang('txt'), null, 'unknown ext → regex fallback');

  // 2. boot the real engine and load two grammars (init resolves valueless;
  //    TreeSitter IS the Parser class — Language is a static on it)
  await TreeSitter.init({ locateFile: f => path.join(VENDOR, f) });
  const jsParser = new TreeSitter();
  jsParser.setLanguage(await TreeSitter.Language.load(path.join(VENDOR, 'ts', 'tree-sitter-javascript.wasm')));
  const pyParser = new TreeSitter();
  pyParser.setLanguage(await TreeSitter.Language.load(path.join(VENDOR, 'ts', 'tree-sitter-python.wasm')));

  // 3. JS extraction: declarations, classes, methods, arrows — name + line
  const jsCode = [
    'import { x } from "./x.js";',
    'function computeTotal(items) {',
    '  return items.length;',
    '}',
    'const dbl = (n) => n * 2;',
    'class Cart {',
    '  add(item) { return 1; }',
    '}',
    'async function load() {}'
  ].join('\n');
  const js = REVATS.extractWith(jsParser, 'javascript', jsCode);
  const find = (n) => js.find(s => s.name === n);
  assert.strictEqual(find('computeTotal').kind, 'func');
  assert.strictEqual(find('computeTotal').line, 2, 'line-accurate');
  assert.strictEqual(find('dbl').kind, 'func', 'arrow const is a func');
  assert.strictEqual(find('Cart').kind, 'class');
  assert.strictEqual(find('add').kind, 'method');
  assert.strictEqual(find('load').kind, 'func');
  assert.ok(js.every(s => s.line >= 1 && s.line <= jsCode.split('\n').length), 'lines in range');

  // 4. Python extraction
  const pyCode = 'class Cart:\n    def add(self, item):\n        return 1\n\ndef total(items):\n    return 0\n';
  const py = REVATS.extractWith(pyParser, 'python', pyCode);
  assert.deepStrictEqual(py.map(s => s.kind + ':' + s.name), ['class:Cart', 'method:add', 'func:total']);

  // 5. empty source → empty symbols (not null) for a supported lang
  const empty = REVATS.extractWith(jsParser, 'javascript', '');
  assert.deepStrictEqual(empty, []);

  jsParser.delete();
  pyParser.delete();
  console.log('treesitter: 5/5 scenarios PASS (real WASM parsers, 19 languages vendored)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
