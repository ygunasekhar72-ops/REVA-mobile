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
  assert.strictEqual(LoopCore.injectThreeMap('<html><head><script type="importmap">{"imports":{"three":"https://unpkg.com/three/build/three.module.js"}}</script></head></html>'), '<html><head><script type="importmap">{"imports":{"three":"https://unpkg.com/three/build/three.module.js"}}</script></head></html>', 'project-owned importmap untouched');
  assert.strictEqual(LoopCore.injectThreeMap('<html><head></head><body>plain page</body></html>').indexOf('importmap'), -1, 'non-three page untouched');

  console.log('loopcore: 7/7 scenarios PASS');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
