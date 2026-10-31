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

  console.log('toolkit: 8/8 scenarios PASS');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
