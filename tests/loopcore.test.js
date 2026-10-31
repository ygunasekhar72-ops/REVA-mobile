/* Unit test: core-loop integrity primitives (js/loopcore.js) — context-error
   classification against real provider wordings, group segmentation, and
   compaction guarantees (no orphaned tool messages, budget respected). */
'use strict';
const assert = require('assert');
const LoopCore = require('../js/loopcore.js');

(async () => {
  // 1. context-exhaustion classification — real provider messages
  assert.ok(LoopCore.isContextError(new Error("This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.")), 'openai wording');
  assert.ok(LoopCore.isContextError(new Error('prompt is too long: 250000 tokens > 200000 maximum')), 'anthropic wording');
  assert.ok(LoopCore.isContextError(new Error('The input token count (1200000) exceeds the maximum number of tokens allowed (1000000).')), 'gemini wording');
  assert.ok(LoopCore.isContextError(new Error('HTTP 400: please reduce the length of your messages')), 'generic wording');
  assert.strictEqual(LoopCore.isContextError(new Error('HTTP 429: monthly limit reached')), false, 'quota must NOT look like context');
  assert.strictEqual(LoopCore.isContextError(new Error('HTTP 500: internal server error')), false);
  assert.strictEqual(LoopCore.isContextError(new Error('failed to fetch')), false);

  // 2. groupify: tool results stay glued to their assistant tool_calls
  const seq = [
    { role: 'user', content: 'build it' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'a1', function: { name: 'write_file', arguments: '{"path":"a.js"}' } }] },
    { role: 'tool', tool_call_id: 'a1', content: 'ok' },
    { role: 'assistant', content: 'done writing' },
    { role: 'user', content: 'now test it' }
  ];
  const groups = LoopCore.groupify(seq);
  assert.deepStrictEqual(groups.map(g => g.length), [1, 2, 1, 1], 'group sizes');
  groups.forEach(g => assert.notStrictEqual(g[0].role, 'tool', 'no group may START with a tool message'));

  // 3. compaction: keeps the recent end whole, drops the old end, never orphans
  const long = [];
  for (let r = 0; r < 30; r++) {
    long.push({ role: 'assistant', content: '', tool_calls: [{ id: 't' + r, function: { name: 'write_file', arguments: '{"path":"f' + r + '.js","content":"' + 'x'.repeat(500) + '"}' } }] });
    long.push({ role: 'tool', tool_call_id: 't' + r, content: 'wrote f' + r + '.js' });
    long.push({ role: 'user', content: 'continue round ' + r });
  }
  const res = LoopCore.compactTranscript(long, 6000);
  assert.ok(res.dropped > 0, 'something must be dropped at a tight budget');
  assert.ok(res.kept.length > 0, 'the recent end is always kept');
  assert.ok(res.kept[0].role !== 'tool', 'kept transcript may not start with a tool message');
  // every kept tool message directly follows its own assistant tool_calls
  for (let i = 0; i < res.kept.length; i++) {
    if (res.kept[i].role === 'tool') {
      const prev = res.kept[i - 1];
      assert.ok(prev && prev.tool_calls && prev.tool_calls.some(t => t.id === res.kept[i].tool_call_id), 'orphaned tool message detected');
    }
  }

  // 4. generous budget → nothing dropped
  const all = LoopCore.compactTranscript(long, 1e9);
  assert.strictEqual(all.dropped, 0, 'roomy budget keeps everything');

  // 5. single huge group still kept (never return empty for non-empty input)
  const huge = [{ role: 'assistant', content: '', tool_calls: [{ id: 'h', function: { name: 'write_file', arguments: '{"content":"' + 'y'.repeat(50000) + '"}' } }] }, { role: 'tool', tool_call_id: 'h', content: 'ok' }];
  const one = LoopCore.compactTranscript(huge, 10);
  assert.strictEqual(one.kept.length, 2, 'an over-budget single group is still kept');
  assert.strictEqual(one.dropped, 0);

  // 6. parallel-reads classifier: all-read-only batches only
  assert.strictEqual(LoopCore.isParallelSafe(['read_file', 'list_files', 'workspace_search']), true, 'read batch is parallel');
  assert.strictEqual(LoopCore.isParallelSafe(['read_file', 'write_file']), false, 'mixed batch stays sequential');
  assert.strictEqual(LoopCore.isParallelSafe(['shell_exec']), false, 'shell never parallel');
  assert.strictEqual(LoopCore.isParallelSafe(['read_file']), false, 'single call gains nothing');
  assert.strictEqual(LoopCore.isParallelSafe([]), false, 'empty batch');

  // 7. three.js provider: import map injected only when needed
  const threeHtml = '<html><head><title>t</title></head><body><script type="module">import * as THREE from "three";</script></body></html>';
  const injected = LoopCore.injectThreeMap(threeHtml);
  assert.ok(injected.indexOf('type="importmap"') >= 0, 'map injected');
  assert.ok(injected.indexOf('js/vendor/three/three.module.js') > 0, 'harness path in map');
  assert.ok(injected.indexOf('<head>' + '<scr' + 'ipt type="importmap"') === 6, 'map lands first inside <head>');
  assert.strictEqual(LoopCore.injectThreeMap(injected), injected, 'idempotent');
  const IMP = '<script type="module">import * as THREE from "three";</script>';
  const cdnMap = '<html><head><script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.164/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.164/examples/jsm/"}}</script></head><body>' + IMP + '</body></html>';
  const rewritten = LoopCore.injectThreeMap(cdnMap);
  assert.ok(rewritten.indexOf('js/vendor/three/three.module.js') >= 0, 'CDN three rewritten to vendored');
  assert.ok(rewritten.indexOf('js/vendor/three/addons/') >= 0, 'CDN addons rewritten to vendored');
  assert.ok(rewritten.indexOf('cdn.jsdelivr') < 0, 'no CDN left');
  const localMap = '<html><head><script type="importmap">{"imports":{"three":"./vendor/three.module.js"}}</script></head><body>' + IMP + '</body></html>';
  assert.strictEqual(LoopCore.injectThreeMap(localMap), localMap, 'explicit local paths untouched');
  assert.strictEqual(LoopCore.injectThreeMap('<html><head></head><body>plain page</body></html>').indexOf('importmap'), -1, 'non-three page untouched');

  // 7. tool watchdog: budgets, honest timeout, wedge after 3, reset on success
  LoopCore.DEFAULT_BUDGETS['test_tool'] = 60;
  const health = LoopCore.makeToolHealth();
  const fast = await LoopCore.withBudget(() => Promise.resolve('fine'), 'test_tool', health);
  assert.ok(fast.ok && fast.value === 'fine', 'fast tool passes through');

  let hangRuns = 0;
  const hang = () => { hangRuns++; return new Promise(() => { }); }; // never settles
  for (let i = 0; i < 3; i++) {
    const r = await LoopCore.withBudget(hang, 'test_tool', health);
    assert.ok(!r.ok && r.timedOut, 'timeout ' + (i + 1) + ' reported honestly');
  }
  assert.strictEqual(hangRuns, 3, 'hanging tool ran each attempt');
  const wedged = await LoopCore.withBudget(hang, 'test_tool', health);
  assert.ok(wedged.wedged && !wedged.ok, '4th call wedged without running');
  assert.strictEqual(hangRuns, 3, 'wedged call never started the tool');
  assert.ok(/unresponsive/.test(wedged.out), 'wedged message explains itself');
  const ok2 = await LoopCore.withBudget(() => Promise.resolve('back'), 'test_tool', health);
  assert.ok(!ok2.ok && ok2.wedged, 'cooldown holds (call skipped, tool never started)');
  health['test_tool'].wedgedUntil = Date.now() - 1; // simulate the cooldown elapsing
  const ok3 = await LoopCore.withBudget(() => Promise.resolve('back'), 'test_tool', health);
  assert.ok(ok3.ok && ok3.value === 'back', 'after cooldown the tool runs and resets the counter');
  delete LoopCore.DEFAULT_BUDGETS['test_tool'];

  // 8. L2b edit ladder: whitespace recovery, fuzzy recovery, honest rejection
  // 8a. tier 1 — model sends a DEDENTED block; the file keeps its real indent
  const fileA = [
    'function a() {',
    '  if (x) {',
    '    doWork(x);',
    '    return true;',
    '  }',
    '}'
  ].join('\n');
  const oldA = ['if (x) {', '  doWork(x);', '  return true;', '}'].join('\n');
  const newA = ['if (x) {', '  check(x);', '  doWork(x);', '  return true;', '}'].join('\n');
  const t1 = LoopCore.editLadder(fileA, oldA, newA);
  assert.ok(t1 && t1.recovery === 'whitespace-normalized', 'tier 1 fires on indentation drift');
  assert.ok(t1.updated.indexOf('\n  if (x) {') >= 0, 'first line keeps the file indent');
  assert.ok(t1.updated.indexOf('\n    check(x);') >= 0, 'inserted line re-indented to file level');
  assert.ok(t1.updated.indexOf('\n    doWork(x);') >= 0, 'kept line re-indented too');
  assert.ok(t1.updated.indexOf('\n}') >= 0, 'closing brace back at column 0');

  // 8b. tier 1 — model COPIES the real indents (offset 0): clean swap, no double-indent
  const oldB = ['  if (x) {', '    doWork(x);', '    return true;', '  }'].join('\n');
  const newB = ['  if (x) {', '    doWork(x);', '    return !!x;', '  }'].join('\n');
  const t2 = LoopCore.editLadder(fileA, oldB, newB);
  assert.ok(t2 && t2.recovery === 'whitespace-normalized', 'tier 1 fires with drifted old, clean new');
  assert.strictEqual(t2.updated, fileA.split('    return true;').join('    return !!x;'), 'offset-0 edit is an exact swap');

  // 8c. tier 2 — model re-typed the block with drift the normalizer can't fix
  const fileC = [
    'function total(items) {',
    '  var sum = 0;',
    '  for (var i = 0; i < items.length; i++) sum += items[i].cost;',
    '  return sum;',
    '}',
    'module.exports = { total: total };'
  ].join('\n');
  const oldC = [
    'function total(items) {',
    '  var sum = 0;',
    '  for (var i = 0; i < items.length; i++) sum += items[i].price;',
    '  return sum;',
    '}'
  ].join('\n');
  const newC = [
    'function total(items) {',
    '  let sum = 0;',
    '  for (const it of items) sum += it.cost;',
    '  return sum;',
    '}'
  ].join('\n');
  const t3 = LoopCore.editLadder(fileC, oldC, newC);
  assert.ok(t3 && /^fuzzy \d+%$/.test(t3.recovery), 'tier 2 fires on a re-typed block: ' + (t3 && t3.recovery));
  assert.ok(t3.updated.indexOf('for (const it of items)') >= 0, 'fuzzy replacement landed');
  assert.ok(t3.updated.indexOf('module.exports') >= 0, 'rest of the file intact');

  // 8d. tier 2 runner-up rejection — two equally similar regions → refuse
  const fileD = [
    'function a(p) { return p.price; }',
    'function b(p) { return p.cost; }',
    'function c(p) { return p.price; }'
  ].join('\n');
  const oldD = 'function x(p) { return p.price; }';
  assert.strictEqual(LoopCore.editLadder(fileD, oldD, 'REPLACED'), null, 'ambiguous fuzzy match is rejected');

  // 8e. nothing anywhere → honest null (caller keeps its error path)
  assert.strictEqual(LoopCore.editLadder('totally different text', 'xyz block here', 'new'), null, 'no match → honest null');

  // 9. L6 RunState: mid-run snapshot survives process death
  const many = [];
  for (let i = 0; i < 50; i++) many.push({ name: 'write_file', args: { path: 'f' + i + '.js' }, ok: true, out: 'ok' });
  const snap = LoopCore.snapshotRun(many);
  assert.strictEqual(snap.v, 1, 'envelope version');
  assert.strictEqual(snap.rows.length, 40, 'snapshot capped at 40 rows');
  assert.strictEqual(snap.rows[39].p, 'f49.js', 'capped keeps the MOST RECENT rows');
  const big = LoopCore.snapshotRun([{ name: 'write_file', args: { path: 'x'.repeat(300) }, ok: false, out: 'z'.repeat(500) }]);
  assert.ok(big.rows[0].p.length <= 120 && big.rows[0].o.length <= 160, 'rows compacted');
  assert.strictEqual(big.rows[0].ok, false, 'failure recorded honestly');

  assert.strictEqual(LoopCore.validRunState(null), null, 'null rejected');
  assert.strictEqual(LoopCore.validRunState({ v: 2, rows: [] }), null, 'wrong version rejected');
  assert.strictEqual(LoopCore.validRunState({ v: 1, rows: 'nope' }), null, 'non-array rows rejected');
  assert.strictEqual(LoopCore.validRunState({ v: 1, rows: [null, 5, {}] }), null, 'all-junk rows rejected');
  const okSt = LoopCore.validRunState({ v: 1, at: 123, rows: [{ t: 'edit_file', p: 'a.js', ok: true }, { junk: 1 }] });
  assert.ok(okSt && okSt.rows.length === 1 && okSt.rows[0].t === 'edit_file', 'junk rows dropped, good rows kept');
  const brief = LoopCore.resumeBrief({ v: 1, at: 1, rows: [{ t: 'write_file', p: 'app.js', ok: true }, { t: 'shell_exec', p: 'npm test', ok: false }] });
  assert.ok(brief.indexOf('write_file app.js — ok') >= 0, 'brief lists applied work');
  assert.ok(brief.indexOf('shell_exec npm test — FAILED (react to this)') >= 0, 'failed calls demand a reaction');
  assert.strictEqual(LoopCore.resumeBrief(null), '', 'no snapshot → empty brief');

  // 10. W5 state-of-the-world: the compaction continuation block
  const sotw = LoopCore.buildSotW({
    userText: 'Build a pomodoro timer with sounds and stats',
    todos: [{ t: 'plan', done: true }, { t: 'index.html', done: true }, { t: 'wire timer', done: false }],
    files: { 'src/app.js': 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8', 'index.html': 'x' },
    toolRows: [{ t: 'write_file', p: 'index.html', ok: true }, { t: 'edit_file', p: 'src/app.js', ok: false }]
  });
  assert.ok(sotw.indexOf('STATE OF THE WORLD') === 0, 'header');
  assert.ok(sotw.indexOf('pomodoro') > 0, 'task carried');
  assert.ok(sotw.indexOf('2/3 done') > 0 && s0twCheck(sotw), 'todos with done marks');
  assert.ok(sotw.indexOf('2 file(s)') > 0, 'file count');
  assert.ok(sotw.indexOf('src/app.js (8 ln)') > 0, 'file with line count');
  assert.ok(sotw.indexOf('edit_file src/app.js — FAILED') > 0, 'latest action with honest failure');
  assert.ok(sotw.length <= 1400, 'bounded (' + sotw.length + ')');
  /* recency: the LAST touched file leads the key-files list */
  assert.ok(sotw.indexOf('key files: src/app.js') > 0, 'recency ordering from tool rows');
  /* empty session → still a valid, small block */
  const empty = LoopCore.buildSotW({});
  assert.ok(empty.indexOf('STATE OF THE WORLD') === 0 && empty.length < 300, 'empty-safe');
  function s0twCheck(s) { return s.indexOf('[ ] wire timer') > 0; }

  console.log('loopcore: 10/10 scenarios PASS');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
