/* Unit test: IDE core (js/idecore.js) — tree building, workspace search
   ranking, autocomplete over doc identifiers + language dictionaries,
   typing intelligence (auto-indent, bracket pairing), caret math.
   Plus the completion dictionaries (js/ide-keywords.js) sanity. */
'use strict';
const assert = require('assert');
const C = require('../js/idecore.js');
const KW = require('../js/ide-keywords.js');

(async () => {
  // 1. buildTree: nested folders, dirs first, alphabetical
  const tree = C.buildTree([
    'src/deep/a.js', 'src/b.js', 'index.html', 'README.md', 'src/deep/z.js'
  ]);
  assert.deepStrictEqual(Object.keys(tree.dirs), ['src'], 'top-level dir');
  assert.deepStrictEqual(tree.files.map(f => f.name), ['index.html', 'README.md'], 'files sorted case-insensitively');
  assert.deepStrictEqual(Object.keys(tree.dirs.src.dirs), ['deep'], 'nested dir');
  assert.deepStrictEqual(tree.dirs.src.files.map(f => f.name), ['b.js'], 'dir file');
  assert.deepStrictEqual(tree.dirs.src.dirs.deep.files.map(f => f.name), ['a.js', 'z.js'], 'deep files sorted');

  // 2. flattenTree: ordered rows with depth (dirs before their files)
  const rows = C.flattenTree(tree, 0);
  assert.strictEqual(rows[0].kind, 'dir');
  assert.strictEqual(rows[rows.length - 1].path, 'README.md', 'root files come after the tree');
  assert.ok(rows.every((r, i) => i === 0 || r.depth <= rows[i - 1].depth + 1), 'depths sane');
  // collapsed dir hides its children
  const collapsedRows = C.flattenTree(tree, 0, [], { 'deep/1': true });
  assert.ok(!collapsedRows.some(r => r.path === 'src/deep/a.js'), 'collapsed hides children');

  // 3. searchWorkspace: substring beats token-only, path hits boost
  const files = {
    'src/app.js': 'export function renderCart(c) {\n  return c.total();\n}',
    'src/cart.js': 'class Cart {\n  total() { return 0; }\n}',
    'docs/readme.md': 'The cart renders items.'
  };
  const hits = C.searchWorkspace(files, 'cart total');
  assert.ok(hits.length >= 4, 'multiple hits');
  /* files covering BOTH query tokens rank above partial files — the
     docs line mentions "cart" alone, so it lands below every src hit */
  const firstPartial = hits.findIndex(h => h.path === 'docs/readme.md');
  const lastFull = hits.map(h => h.path).lastIndexOf('src/cart.js');
  assert.ok(lastFull < firstPartial, 'full-coverage files rank above partial ones');
  assert.ok(hits.some(h => h.path === 'src/cart.js' && h.line === 2), 'the total() line is found');
  assert.ok(hits.every(h => h.line >= 1 && typeof h.text === 'string'), 'hit shape');
  assert.strictEqual(C.searchWorkspace(files, '').length, 0, 'empty query → no hits');
  assert.ok(C.searchWorkspace(files, 'cart').length >= 3, 'token hits across files');

  // 4. autocomplete: doc identifiers rank above keywords, prefix-only
  const doc = 'const renderCart = (c) => c;\nconst renderer = 1;\nrender';
  const ac = C.autocomplete(doc, doc.length, 'js', KW.forExt('js'));
  assert.strictEqual(ac.word, 'render', 'word under caret');
  assert.ok(ac.items[0].name === 'renderCart', 'frequent doc name first, got ' + (ac.items[0] || {}).name);
  assert.ok(ac.items.some(i => i.name === 'renderer'), 'second doc name present');
  assert.ok(!ac.items.some(i => i.name === 'return'), 'non-prefix keyword excluded');
  // keywords join when prefix-matching a doc-less word
  const ac2 = C.autocomplete('const x = 1;\nfo', doc.length + 2, 'js', KW.forExt('js'));
  assert.ok(ac2.items.some(i => i.name === 'for'), 'keyword for completes');
  // tiny prefix → no suggestions (noise guard)
  assert.strictEqual(C.autocomplete('a', 1, 'js', KW.forExt('js')).items.length, 0, '1-char prefix stays quiet');

  // 5. typing intelligence: auto-indent keeps level, deepens after opener,
  //    and indents between |}
  const base = 'function a() {\n  doWork();';
  assert.deepStrictEqual(C.autoIndent(base, base.length).indent, '  ', 'keeps block indent');
  const opener = 'function a() {';
  assert.deepStrictEqual(C.autoIndent(opener, opener.length).indent, '  ', 'one deeper after a col-0 {');
  const bi = C.autoIndent('if (x) {\n}', 9); // caret on the empty line before the closer
  assert.strictEqual(bi.indent, '  ', 'between-braces: enclosing child level');
  assert.strictEqual(bi.skipIndent, true, 'between-braces: closer stays put');

  // 6. bracketAuto: pairs only where safe (never inside a word)
  assert.strictEqual(C.bracketAuto('(', 'x'), null, 'no pair inside a word');
  assert.strictEqual(C.bracketAuto('(', ' '), ')', 'pairs before space');
  assert.strictEqual(C.bracketAuto('(', ''), ')', 'pairs at EOL');
  assert.strictEqual(C.bracketAuto('{', '\n'), '}', 'pairs before newline');
  assert.strictEqual(C.bracketAuto('"', 'a'), null, 'quote before word → no pair');

  // 7. lineCol: status-bar math
  assert.deepStrictEqual(C.lineCol('ab\ncd', 4), { line: 2, col: 2 });
  assert.deepStrictEqual(C.lineCol('', 0), { line: 1, col: 1 });

  // 8. dictionaries: 12 languages load, every table populated, no dupes
  const langs = ['js', 'ts', 'html', 'css', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'php', 'sh'];
  langs.forEach(l => {
    const d = KW.forExt(l);
    assert.ok(d.keywords.length >= 10 && d.builtins.length >= 40, l + ' tables populated');
    const all = d.keywords.concat(d.builtins);
    assert.strictEqual(new Set(all).size, all.length, l + ' has no duplicate tokens');
  });
  assert.strictEqual(KW.forExt('unknown-ext'), KW.MAP.js, 'unknown → js tables (safe default)');

  console.log('idecore: 8/8 scenarios PASS (' + langs.length + ' languages, ' +
    langs.reduce((n, l) => n + KW.MAP[l].keywords.length + KW.MAP[l].builtins.length, 0) + ' completion tokens)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
