/* Unit test: toolkit core (js/toolkit.js) — the utility tools' engines.
   Real parser math (no eval), RFC-4180 CSV, JSON path walker, codecs,
   marker scanner, word counts, UUID shape/uniqueness, unified diffs. */
'use strict';
const assert = require('assert');
const T = require('../js/toolkit.js');

(async () => {
  // 1. mathEval: precedence, unary, right-assoc power, functions, consts
  assert.strictEqual(T.mathEval('1+2*3'), 7, 'precedence');
  assert.strictEqual(T.mathEval('(1+2)*3'), 9, 'parens');
  assert.strictEqual(T.mathEval('-3+5'), 2, 'unary minus');
  assert.strictEqual(T.mathEval('2^3^2'), 512, 'power is right-assoc');
  assert.strictEqual(T.mathEval('10%3'), 1, 'modulo');
  assert.strictEqual(T.mathEval('sqrt(144)+floor(2.7)'), 14, 'functions');
  assert.strictEqual(T.mathEval('max(1, 9, 4)'), 9, 'multi-arg');
  assert.strictEqual(T.mathEval('round(pi*100)/100'), 3.14, 'pi constant');
  assert.strictEqual(T.mathEval('2*-3'), -6, 'unary after operator');
  assert.throws(() => T.mathEval('process.exit(1)'), /unknown name/, 'hostile names rejected');
  assert.throws(() => T.mathEval('constructor'), /unknown name/, 'prototype names rejected');
  assert.throws(() => T.mathEval('1+'), /unexpected/, 'trailing operator rejected');
  assert.throws(() => T.mathEval('1; process'), /trailing/, 'injection rejected');

  // 2. csvParse: quoted fields, escaped quotes, CRLF, header naming
  const csv = T.csvParse('name,note\n"Smith, John","said ""hi"""\nAmy,ok');
  assert.strictEqual(csv.headers.join('|'), 'name|note', 'headers');
  assert.strictEqual(csv.rows[0].name, 'Smith, John', 'quoted comma kept');
  assert.strictEqual(csv.rows[0].note, 'said "hi"', 'escaped quotes unescaped');
  assert.strictEqual(csv.rows[1].note, 'ok', 'plain field');
  const csv2 = T.csvParse('a\r\n1\r\n2\r\n');
  assert.strictEqual(csv2.rows.length, 2, 'CRLF handled, no ghost row');

  // 3. jsonQuery: paths with arrays, ops
  const data = { users: [{ name: 'Ada' }, { name: 'Ben' }], n: 2 };
  assert.strictEqual(T.jsonQuery(data, 'users[1].name'), 'Ben', 'array path');
  assert.deepStrictEqual(T.jsonQuery(data, 'users[0]', 'keys'), ['name'], 'keys op');
  assert.strictEqual(T.jsonQuery(data, 'users', 'len'), 2, 'len op');
  assert.strictEqual(T.jsonQuery(data, 'users', 'type'), 'array', 'type op');
  assert.throws(() => T.jsonQuery(data, 'users[5].name'), /ends early|no "/, 'missing path honest');

  // 4. encodeDecode: roundtrips incl. unicode
  assert.strictEqual(T.encodeDecode('decode', 'base64', T.encodeDecode('encode', 'base64', 'héllo 🌍')), 'héllo 🌍', 'base64 unicode roundtrip');
  assert.strictEqual(T.encodeDecode('decode', 'uri', T.encodeDecode('encode', 'uri', 'a b&c=d')), 'a b&c=d', 'uri roundtrip');
  assert.strictEqual(T.encodeDecode('encode', 'hex', 'AB'), '4142', 'hex encode');
  assert.strictEqual(T.encodeDecode('decode', 'hex', '4142'), 'AB', 'hex decode');

  // 5. todoScan: markers with file:line, binaries skipped, capped
  const files = {
    'src/a.js': 'ok\n// TODO: fix the loop\nfine\n/* FIXME: memory */',
    'assets/logo.png': 'TODO inside binary ignored',
    'docs/b.md': 'XXX hackish note here'
  };
  const marks = T.todoScan(files);
  assert.strictEqual(marks.length, 3, 'three markers');
  assert.strictEqual(marks[0].path, 'src/a.js');
  assert.strictEqual(marks[0].line, 2);
  assert.strictEqual(marks[0].tag, 'TODO');
  assert.ok(!marks.some(m => m.path === 'assets/logo.png'), 'binaries skipped');

  // 6. wcCalc
  assert.deepStrictEqual(T.wcCalc('one two\nthree\n'), { lines: 3, words: 3, chars: 14 }, 'trailing newline counts');
  assert.deepStrictEqual(T.wcCalc(''), { lines: 0, words: 0, chars: 0 });

  // 7. uuidGen: shape + uniqueness (deterministic rnd injected)
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const ids = T.uuidGen('uuid4', 30, rnd);
  assert.strictEqual(ids.length, 30, 'count honored');
  assert.strictEqual(new Set(ids).size, 30, 'no duplicates');
  const shape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(ids[0]);
  assert.ok(shape, 'uuid4 version+variant bits set: ' + ids[0]);

  // 8. unifiedDiff: vendored jsdiff patch through the same entry
  const d = T.unifiedDiff('line1\nline2\nline3', 'line1\nline TWO\nline3', 'before.js', 'after.js');
  assert.ok(d.indexOf('-line2') >= 0 || d.indexOf('- line2') >= 0, 'removed line shown: ' + d.split('\n')[2]);
  assert.ok(d.indexOf('+line TWO') >= 0 || d.indexOf('+ line TWO') >= 0, 'added line shown');
  const same = T.unifiedDiff('same', 'same', 'a', 'b');
  assert.ok(/identical|^\-\-\-/.test(same), 'no false changes: ' + same.slice(0, 40));

  // 9. batch-2 engines: html→md, rss, stats, cron, csv-gen, schema, color, url
  const html = '<h2>Title</h2><p>Para with <b>bold</b> and a <a href="https://x.io">link</a>.</p><ul><li>one</li><li>two</li></ul><script>evil()</script>';
  const md = T.htmlToMarkdown(html);
  assert.ok(md.indexOf('## Title') === 0, 'heading');
  assert.ok(md.indexOf('**bold**') > 0 && md.indexOf('[link](https://x.io)') > 0, 'inline markup');
  assert.ok(md.indexOf('- one') > 0 && md.indexOf('- two') > 0, 'list items');
  assert.ok(md.indexOf('evil') < 0, 'script dropped');
  const rss = T.rssParse('<rss><channel><title>Feed</title><item><title>i1</title><link>https://a</link><pubDate>Mon, 26 Oct 2026</pubDate><description>b&lt;b&gt; news</description></item><item><title>i2</title><link>https://b</link></item></channel></rss>');
  assert.strictEqual(rss.items.length, 2, 'rss items');
  assert.strictEqual(rss.items[0].title, 'i1', 'rss title');
  assert.ok(rss.items[0].summary.indexOf('news') >= 0, 'summary text');
  const atom = T.rssParse('<feed><title>A</title><entry><title>e1</title><link href="https://c"/><updated>2026-10-31</updated></entry></feed>');
  assert.ok(atom.atom && atom.items[0].link === 'https://c', 'atom href link');
  const st = T.textStats('Run the app. It works well and it is easy to use.');
  assert.ok(st.words === 12 && st.sentences === 2 && st.flesch > 60, 'readability math: ' + JSON.stringify(st));
  const cn = T.cronNext('30 9 * * 1-5', new Date('2026-10-31T10:00:00Z').getTime(), 3);
  const d0 = new Date(cn[0]);
  assert.ok(cn.length === 3 && d0.getHours() === 9 && d0.getMinutes() === 30 && d0.getDay() >= 1 && d0.getDay() <= 5, 'cron weekday 9:30 local: ' + cn[0]);
  assert.ok(cn[0] < cn[1] && cn[1] < cn[2], 'cron strictly increasing');
  const gen = T.csvGenerate([{ a: 1, b: 'x,y', c: 'say "hi"' }]);
  assert.ok(gen.indexOf('"x,y"') >= 0 && gen.indexOf('"say ""hi"""') >= 0, 'csv gen quoting');
  const round = T.csvParse(gen);
  assert.strictEqual(round.rows[0].b, 'x,y', 'csv gen→parse roundtrip');
  const se = T.schemaCheck({ n: 'x' }, { type: 'object', required: ['m'], properties: { m: { type: 'string' }, n: { type: 'number', minimum: 0 } } });
  assert.strictEqual(se.length, 2, 'schema catches missing field AND type violation');
  assert.ok(se.some(function (e) { return e.indexOf('.m required') > 0; }), 'required reported');
  assert.ok(se.some(function (e) { return e.indexOf('.n must be number') > 0; }), 'type violation reported');
  const col = T.colorConvert('#7c5cff');
  assert.strictEqual(col.hex, '#7c5cff', 'hex identity');
  assert.ok(col.contrastOnWhite < 4.5 && col.bestTextOn === '#000', 'contrast math (mid-tone wants black text): ' + col.contrastOnWhite);
  assert.deepStrictEqual(T.urlParse('https://x.io/a/b?q=1&z=2').query, { q: '1', z: '2' }, 'url query');
  assert.ok(T.markdownToc('# A\n```js\n# not a heading\n```\n## B').map(x => x.slug).join(','), 'a,b', 'toc skips code fences');

  // 10. QR: structure + determinism + honesty
  const q1 = T.qrMake('https://reva.mobile/demo');
  assert.strictEqual(q1.version, 2, 'version 2');
  assert.strictEqual(q1.size, 25, 'v2 → 25 modules');
  assert.ok(q1.svg.indexOf('<svg') === 0 && q1.svg.indexOf('viewBox="0 0 33 33"') > 0, 'svg with quiet zone');
  /* finder pattern at three corners: dark ring, light ring, dark core */
  [[0, 0], [0, q1.size - 7], [q1.size - 7, 0]].forEach(function (rc) {
    const r = rc[0], c = rc[1];
    assert.strictEqual(q1.matrix[r][c], 1, 'finder corner dark');
    assert.strictEqual(q1.matrix[r + 3][c + 3], 1, 'finder core dark');
    assert.strictEqual(q1.matrix[r + 1][c + 1], 0, 'finder ring light');
    assert.strictEqual(q1.matrix[r + 3][c + 1], 0, 'finder inner light');
  });
  for (let i = 8; i < q1.size - 8; i++) {
    assert.strictEqual(q1.matrix[6][i], i % 2 === 0 ? 1 : 0, 'timing alternates');
  }
  assert.strictEqual(JSON.stringify(T.qrMake('abc')), JSON.stringify(T.qrMake('abc')), 'deterministic');
  assert.ok(JSON.stringify(T.qrMake('abc', 'L')) !== JSON.stringify(T.qrMake('abc', 'M')), 'ECC level changes the matrix');
  assert.throws(function () { T.qrMake('x'.repeat(200), 'M'); }, /too long/, 'overflow honest');

  // 11. RS PROOF: codeword (data + ec) evaluates to 0 at every generator root
  const exp = [], log = Object.create(null);
  (function () { let x = 1; for (let i = 0; i < 255; i++) { exp.push(x); log[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; } for (let i = 255; i < 512; i++) exp.push(exp[i - 255]); })();
  const mul = (a, b) => (a === 0 || b === 0 ? 0 : exp[log[a] + log[b]]);
  const syndrome = (cw, n) => {
    for (let s = 0; s < n; s++) {
      let acc = 0;
      for (let j = 0; j < cw.length; j++) acc = mul(acc, exp[s]) ^ cw[j];
      if (acc !== 0) return s;
    }
    return -1;
  };
  [[1, 19, 7], [2, 34, 10], [3, 55, 15], [4, 80, 20], [5, 108, 26], [5, 86, 24]].forEach(function (cs) {
    const data = Array.from({ length: cs[1] }, (_, i) => (i * 37 + cs[0] * 11) % 256);
    const cw = data.concat(T.qrRsEc(data, cs[2]));
    const bad = syndrome(cw, cs[2]);
    assert.strictEqual(bad, -1, 'v' + cs[0] + ' RS syndromes zero (failed at α^' + bad + ')');
  });

  // 12. batch-3 engines: md→html (escaping!), stats, merge/flatten, case, mime,
  //     roman, bytes, cron humanize, set ops, line sort
  const htmlOut = T.mdToHtml('# Title\n\nPara with **bold** and [x](https://a.io)\n\n- one\n- two\n\n```js\nlet a = "<b>";\n```');
  assert.ok(htmlOut.indexOf('<h1>Title</h1>') === 0, 'heading');
  assert.ok(htmlOut.indexOf('<strong>bold</strong>') > 0 && htmlOut.indexOf('<a href="https://a.io"') > 0, 'inline rules');
  assert.ok(htmlOut.indexOf('<li>one</li>') > 0 && htmlOut.indexOf('<ul>') > 0, 'list');
  assert.ok(htmlOut.indexOf('&lt;b&gt;') > 0, 'code fence escaped');
  assert.ok(T.mdToHtml('<img src=x onerror=alert(1)>').indexOf('<img') < 0, 'raw html NEVER passes');
  assert.ok(T.mdToHtml('[x](javascript:alert(1))').indexOf('javascript:') < 0, 'javascript: hrefs neutered');
  const agg = T.csvStats([{ c: 'a', v: 1 }, { c: 'a', v: 3 }, { c: 'b', v: 2 }], { groupBy: 'c', field: 'v', op: 'avg' });
  assert.strictEqual(agg[0].avg, 2, 'avg per group');
  assert.strictEqual(agg[0].count, 2, 'count per group');
  assert.deepStrictEqual(T.jsonMerge({ a: { x: 1, keep: 1 } }, { a: { y: 2 } }), { a: { x: 1, keep: 1, y: 2 } }, 'deep merge keeps');
  assert.deepStrictEqual(T.jsonUnflatten(T.jsonFlatten({ a: { b: [1, 2] }, c: 'x' })), { a: { b: [1, 2] }, c: 'x' }, 'flatten roundtrip');
  assert.strictEqual(T.textCase('helloWorld foo_bar', 'kebab'), 'hello-world-foo-bar', 'kebab');
  assert.strictEqual(T.textCase('data-viz-pro', 'camel'), 'dataVizPro', 'camel');
  assert.strictEqual(T.mimeLookup('.glb'), 'model/gltf-binary', 'mime table');
  assert.strictEqual(T.mimeLookup('unknown-ext'), 'application/octet-stream', 'mime fallback');
  assert.strictEqual(T.romanConvert(2026), 'MMXXVI', 'roman to');
  assert.strictEqual(T.romanConvert('mmxxvi'), 2026, 'roman from (case-insensitive)');
  assert.throws(function () { T.romanConvert(4000); }, /1\.\.3999/, 'roman range honest');
  assert.strictEqual(T.byteSize(1536), '1.5 KB', 'bytes format');
  assert.strictEqual(T.byteSize('1.5 KB'), 1536, 'bytes parse');
  assert.strictEqual(T.cronDescribe('30 9 * * 1-5'), 'at 09:30 on Monday through Friday', 'cron humanized');
  const ld = T.listDiff([1, 2, 3], [2, 3, 4]);
  assert.deepStrictEqual(ld.intersect, [2, 3], 'set intersect');
  assert.deepStrictEqual(ld.onlyA, [1], 'set onlyA');
  assert.strictEqual(T.sortLines('b\n10\na\n2', { numeric: true }), '2\n10\na\nb', 'numeric sort (numbers before strings)');

  console.log('toolkit: 12/12 scenarios PASS (incl. RS syndrome proof)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
