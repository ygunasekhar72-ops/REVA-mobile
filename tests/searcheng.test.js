/* Unit test: the REVA Search Engine (js/searcheng.js) — our own inverted index.
   Indexing, ranking (title weight, TF-IDF), AND→OR fallback, phrase queries,
   fuzzy fallback, incremental updates, suggestions, empty states. */
'use strict';
const assert = require('assert');
const S = require('../js/searcheng.js');

(async () => {
  // 1. tokenization: lowercase, stopwords, min length, light stem
  /* stems are verified by MATCHING (query stem === doc stem), not exact strings */
  function stemsMatch(queryWord, docWord) {
    return S.tokenize(queryWord)[0] === S.tokenize(docWord)[0];
  }
  var toks1 = S.tokenize('The Running Cats ARE Fast');
  assert.strictEqual(toks1.length, 3, 'stopwords + short dropped');
  assert.ok(stemsMatch('running', 'running') && stemsMatch('run', 'running'), 'run/running share a stem');
  assert.ok(stemsMatch('cat', 'cats'), 'cat/cats share a stem');
  assert.ok(toks1.some(t => t === S.tokenize('fast')[0]), 'fast passes through');
  assert.deepStrictEqual(S.tokenize('a I to'), [], 'short + stopword only');
  assert.ok(stemsMatch('camelCase', 'camelcase'), 'case-insensitive stems');

  // 2. indexing + basic AND search
  var ix = S.createIndex();
  S.addDoc(ix, 'd1', { title: 'Pomodoro Timer', body: 'A focus timer with work and break sessions.' });
  S.addDoc(ix, 'd2', { title: 'Todo List', body: 'Track your daily tasks with the timer integration.' });
  S.addDoc(ix, 'd3', { title: 'Weather App', body: 'Forecast display with hourly breakdown.' });
  var r1 = S.search(ix, 'timer');
  assert.strictEqual(r1.length, 2, 'both timer docs');
  assert.ok(r1[0].id === 'd1', 'title match outranks body match (weight ×3): ' + r1[0].id);
  assert.deepStrictEqual(r1[0].matched, ['timer'], 'matched terms reported');
  assert.ok(r1[0].fields.indexOf('title') >= 0, 'field hits reported');

  // 3. AND semantics: all terms required
  var r2 = S.search(ix, 'timer tasks');
  assert.strictEqual(r2.length, 1, 'AND narrows to one doc');
  assert.strictEqual(r2[0].id, 'd2', 'the doc holding both terms');
  assert.strictEqual(r2[0].matched.length, 2, 'both terms reported matched');
  // OR fallback when AND yields nothing
  var r3 = S.search(ix, 'timer weather');
  assert.ok(r3.length >= 2, 'OR fallback when AND is empty');
  assert.ok(r3[0].score >= r3[1].score, 'ranked best-first');
  // strict mode refuses the fallback
  assert.strictEqual(S.search(ix, 'timer weather', { strict: true }).length, 0, 'strict refuses OR fallback');

  // 4. ranking: TF-IDF — the doc with MORE timer mentions wins
  var ix2 = S.createIndex();
  S.addDoc(ix2, 'a', { title: 'Note', body: 'timer timer timer once more' });
  S.addDoc(ix2, 'b', { title: 'Other', body: 'timer briefly mentioned here' });
  var r4 = S.search(ix2, 'timer');
  assert.strictEqual(r4[0].id, 'a', 'higher TF ranks first');

  // 5. phrase query: consecutive tokens beat bag-of-words
  var ix3 = S.createIndex();
  S.addDoc(ix3, 'p1', { title: 'Guide', body: 'the quick brown fox jumps' });
  S.addDoc(ix3, 'p2', { title: 'Other', body: 'quick the brown fox jumps around' });
  var r5 = S.search(ix3, 'quick brown');
  assert.strictEqual(r5.length, 1, 'phrase matches consecutive only');
  assert.strictEqual(r5[0].id, 'p1', 'p2 reordered words excluded (stopword gap respected)');

  // 6. incremental updates: re-add replaces; remove cleans postings
  S.addDoc(ix3, 'p1', { title: 'Guide v2', body: 'updated content about testing' });
  var r6 = S.search(ix3, 'quick brown');
  assert.ok(!r6.some(x => x.id === 'p1'), 're-add replaced the old content (old tokens gone)');
  var r7 = S.search(ix3, 'guide');
  assert.ok(r7.some(x => x.id === 'p1'), 'new content searchable');
  S.removeDoc(ix3, 'p1');
  var r8 = S.search(ix3, 'testing');
  assert.ok(!r8.some(x => x.id === 'p1'), 'removed doc is gone');
  var r9 = S.search(ix3, 'guide');
  assert.ok(!r9.some(x => x.id === 'p1'), 'postings cleaned on remove');

  // 7. fuzzy fallback: typo resolves within distance 2
  var ix4 = S.createIndex();
  S.addDoc(ix4, 'f1', { title: 'Settings', body: 'preferences and configuration live here' });
  var r10 = S.search(ix4, 'confgration', { fuzzy: true }); // distance-2 typo of "configuration"
  assert.ok(r10.some(x => x.id === 'f1'), 'fuzzy finds the typo');
  assert.ok(r10[0].matched.length >= 1, 'the matched (stemmed) query term is reported');
  var r11 = S.search(ix4, 'confgration', { fuzzy: false });
  assert.strictEqual(r11.length, 0, 'fuzzy off → honest empty (no exact stem match)');
  // garbage stays unmatched even with fuzzy (distance gate)
  assert.strictEqual(S.search(ix4, 'zzzzzzzz', { fuzzy: true }).length, 0, 'distant garbage refused');

  // 8. suggest: vocabulary prefix scan
  var sug = S.suggest(ix4, 'set');
  assert.ok(sug.indexOf('set') >= 0, 'prefix suggestion (stemmed vocab): ' + JSON.stringify(sug));
  assert.deepStrictEqual(S.suggest(ix4, 'z'), [], 'no suggestion for absent prefix');
  assert.deepStrictEqual(S.suggest(ix4, 's'), [], 'short prefix stays quiet');

  // 9. empty states + limit
  var empty = S.createIndex();
  assert.deepStrictEqual(S.search(empty, 'anything'), [], 'empty index → no results');
  assert.deepStrictEqual(S.search(ix, ''), [], 'empty query → no results');
  var many = S.createIndex();
  for (var i = 0; i < 30; i++) S.addDoc(many, 'm' + i, { title: 'bulk ' + i, body: 'timer bulk content number ' + i });
  assert.strictEqual(S.search(many, 'timer').length, 20, 'limit caps results (default 20)');
  assert.strictEqual(S.search(many, 'timer', { limit: 5 }).length, 5, 'limit honored');

  // 10. editDistance: bounds + early exit
  assert.strictEqual(S.editDistance('cat', 'cat', 2), 0, 'identical');
  assert.strictEqual(S.editDistance('cat', 'cart', 2), 1, 'one insert');
  assert.strictEqual(S.editDistance('cat', 'cast', 2), 1, 'one sub');
  assert.strictEqual(S.editDistance('cat', 'dog', 1), 2, '3 subs > maxDist 1 → exits at 2');
  assert.strictEqual(S.editDistance('abc', 'xy', 5), 3, 'full distance when allowed');

  console.log('searcheng: 10/10 scenarios PASS (inverted index + ranking + phrase + fuzzy)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
