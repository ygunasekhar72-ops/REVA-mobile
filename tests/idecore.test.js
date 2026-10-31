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

  // 9. Phase B: find/replace, bracket match, change markers, palette score
  const hay = 'const a = 1;\nconst b = const a;\nconst A = 3;';
  const fm = C.findMatches(hay, 'const a');
  assert.strictEqual(fm.length, 3, 'case-insensitive default (incl. const A): ' + fm.length);
  assert.ok(fm[0].line === 1 && fm[1].line === 2, 'line numbers right');
  assert.strictEqual(C.findMatches(hay, 'const a', { caseSensitive: true }).length, 2, 'case-sensitive');
  assert.strictEqual(C.findMatches(hay, 'a', { wholeWord: true }).length, 3, 'whole-word a/A: 3');
  assert.strictEqual(C.findMatches(hay, 'const a(', { regex: true }), null, 'bad regex → honest null');
  const rx = C.findMatches(hay, 'const \\w+ = \\d;', { regex: true, caseSensitive: true });
  assert.strictEqual(rx.length, 2, 'regex mode');
  const rep = C.replaceAll(hay, 'const a', 'let x', { caseSensitive: true });
  assert.strictEqual(rep.count, 2, 'case-sensitive replace count');
  assert.ok(rep.text.indexOf('let x = 1;') === 0, 'replaced back-to-front, text intact');
  assert.ok(C.replaceAll(hay, 'zzz', 'q').count === 0, 'no-match replace is a no-op');

  const code = 'function f() {\n  if (x) {\n    work();\n  }\n}';
  const bm = C.bracketMatch(code, code.indexOf('work')); // caret inside inner block
  assert.strictEqual(bm, null, 'not beside a bracket → null');
  const bm2 = C.bracketMatch(code, code.indexOf('{', code.indexOf('if')) + 1);
  assert.ok(bm2 && code[bm2.a] === '{' && code[bm2.b] === '}', 'inner { pairs with its }');
  const bm3 = C.bracketMatch(code, code.length); // just past final }
  assert.ok(bm3 && bm3.a === code.indexOf('{'), 'outer brace pairs');

  const saved = 'one\ntwo\nthree\nfour';
  const edited = 'one\nTWO\nthree\nfour\nfive';
  const mk = C.changeMarkers(saved, edited);
  assert.strictEqual(mk['2'], 'mod', 'changed line marked');
  assert.strictEqual(mk['5'], 'add', 'added line marked');
  assert.ok(!mk['1'] && !mk['3'], 'untouched lines unmarked');
  assert.deepStrictEqual(C.changeMarkers('same', 'same'), {}, 'identical → no marks');

  assert.ok(C.paletteScore('refo', 'refreshOutline') >= 20, 'subsequence with contiguity bonus');
  assert.ok(C.paletteScore('refo', 'refreshOutline') > C.paletteScore('ro', 'refreshOutline'), 'streaks beat gappy matches');
  assert.strictEqual(C.paletteScore('xyz', 'save'), 0, 'no match → 0');
  assert.ok(C.paletteScore('save', 'save') > C.paletteScore('save', 'save_memory'), 'prefix beats substring');

  console.log('idecore: 9/9 scenarios PASS (' + langs.length + ' languages, ' +
    langs.reduce((n, l) => n + KW.MAP[l].keywords.length + KW.MAP[l].builtins.length, 0) + ' completion tokens)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
