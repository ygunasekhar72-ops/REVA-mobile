/* Unit test: model metadata registry (js/modeldb.js + js/modeldb-data.js).
   Verifies the bundled snapshot, id lookup semantics (case, slash alias),
   capability flags, and that runtime trim() matches the generator's logic.
   Fully data-driven — survives snapshot regeneration. */
'use strict';
const assert = require('assert');

global.window = global; // data file attaches to window; runtime exports via module.exports
require('../js/modeldb-data.js');
const mdb = require('../js/modeldb.js');

(async () => {
  // 1. snapshot sanity: thousands of ids, ISO date
  assert.ok(mdb.size() > 1000, 'snapshot should carry 1000+ model ids, got ' + mdb.size());
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(mdb.gen()), 'snapshot date should be ISO');

  // 2. misses are honest nulls
  assert.strictEqual(mdb.lookup(''), null);
  assert.strictEqual(mdb.lookup('definitely-not-a-real-model-xyz'), null);

  // 3. case-insensitive id lookup on a real entry
  const anyId = Object.keys(global.REVAMODELDB_DATA.m)[0];
  assert.deepStrictEqual(mdb.lookup(anyId.toUpperCase()), mdb.lookup(anyId), 'lookup should be case-insensitive');

  // 4. slash alias: 'meta/llama-3.3' resolves via its tail too
  const slashed = Object.keys(global.REVAMODELDB_DATA.m).find(k => k.indexOf('/') > 0);
  if (slashed) {
    const tail = slashed.split('/').pop();
    assert.deepStrictEqual(mdb.lookup(tail), mdb.lookup(slashed), 'tail alias should resolve');
  }

  // 5. capability flags round-trip from the data
  const m = global.REVAMODELDB_DATA.m;
  const withCtx = Object.keys(m).find(k => m[k][0] >= 8192);
  assert.ok(withCtx && mdb.lookup(withCtx).ctx >= 8192, 'context tokens should round-trip');
  const visionId = Object.keys(m).find(k => m[k][1] & 1);
  assert.ok(visionId && mdb.lookup(visionId).vision === true, 'vision flag should round-trip');
  const toolsId = Object.keys(m).find(k => m[k][1] & 2);
  assert.ok(toolsId && mdb.lookup(toolsId).tools === true, 'tool_call flag should round-trip');

  // 6. trim parity: runtime trim() on a synthetic provider matches spec
  const t = mdb.trim({
    prov: { models: {
      'Test/Vision-Model': { id: 'Test/Vision-Model', limit: { context: 131072 }, modalities: { input: ['text', 'image'] }, tool_call: true, reasoning: false, attachment: false },
      'plain-id': { id: 'plain-id' }
    } }
  });
  assert.deepStrictEqual(t.m['test/vision-model'], [131072, 3], 'vision+tools flags and ctx');
  assert.deepStrictEqual(t.m['vision-model'], [131072, 3], 'tail alias written');
  assert.deepStrictEqual(t.m['plain-id'], [0, 0], 'missing fields default to 0');

  console.log('modeldb: 6/6 scenarios PASS (' + mdb.size() + ' ids, snapshot ' + mdb.gen() + ')');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
