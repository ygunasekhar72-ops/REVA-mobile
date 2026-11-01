/* Unit test: the Task Scheduler Engine (js/scheduler.js) — subsystem #9.
   Cron parsing, next-run search, drift correction, missed-run policy,
   one-off/interval/cron tasks, persistence. Deterministic via injected clock. */
'use strict';
const assert = require('assert');
const S = require('../js/scheduler.js');

(async () => {
  /* fixed clock: Sunday 2026-11-01 10:00 local */
  const BASE = new Date(2026, 10, 1, 10, 0, 0).getTime();
  const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0).getTime();

  // 1. parseCron: field expansion + validation
  let c = S.parseCron('*/15 */6 1,15 * 1-5');
  assert.deepStrictEqual(c.mins, [0, 15, 30, 45], '*/15 minutes');
  assert.deepStrictEqual(c.hours, [0, 6, 12, 18], '*/6 hours');
  assert.deepStrictEqual(c.doms, [1, 15], 'list doms');
  assert.deepStrictEqual(c.months, [1,2,3,4,5,6,7,8,9,10,11,12], 'all months');
  assert.deepStrictEqual(c.dows, [1,2,3,4,5], 'dow range, 7 folds to 0');
  assert.ok(c.domRestricted && c.dowRestricted, 'restriction flags');
  assert.throws(() => S.parseCron('* * *'), /5 fields/, 'field count enforced');
  assert.throws(() => S.parseCron('61 * * * *'), /range/, 'minute 61 rejected');
  assert.throws(() => S.parseCron('*/0 * * * *'), /step/, 'zero step rejected');

  // 2. cronNext minute stepping: */5 lands on the next 5-minute boundary
  assert.strictEqual(S.cronNext('*/5 * * * *', new Date(BASE)), at(2026, 11, 1, 10, 5), '10:00 -> 10:05');
  assert.strictEqual(S.cronNext('*/5 * * * *', new Date(at(2026, 11, 1, 10, 5))), at(2026, 11, 1, 10, 10), 'on the boundary -> next one');

  // 3. cronNext day rollover: 14:30 in the past today -> tomorrow 14:30
  assert.strictEqual(S.cronNext('30 14 * * *', new Date(at(2026, 11, 1, 10, 0))), at(2026, 11, 1, 14, 30), 'same day');
  assert.strictEqual(S.cronNext('30 14 * * *', new Date(at(2026, 11, 1, 15, 0))), at(2026, 11, 2, 14, 30), 'next day after rollover');

  // 4. cronNext dow: Sunday -> next Monday noon
  assert.strictEqual(S.cronNext('0 12 * * 1', new Date(at(2026, 11, 1, 10, 0))), at(2026, 11, 2, 12, 0), 'next Monday noon');
  assert.strictEqual(S.cronNext('0 12 * * 1', new Date(at(2026, 11, 2, 12, 0))), at(2026, 11, 9, 12, 0), 'on Monday noon -> next Monday');

  // 5. dom/dow OR semantics (vixie): 13th OR Friday, whichever first
  assert.strictEqual(S.cronNext('0 9 13 * 5', new Date(at(2026, 11, 1, 10, 0))), at(2026, 11, 6, 9, 0), 'Friday Nov 6 beats 13th');
  assert.strictEqual(S.cronNext('0 9 13 * 5', new Date(at(2026, 11, 14, 10, 0))), at(2026, 11, 20, 9, 0), 'OR semantics: next Friday Nov 20 (13th is Dec 13, later)');

  // 6. one-off {at}: fires once at/below the target, then is gone
  {
    const now = { v: BASE };
    const s = S.createScheduler({ now: () => now.v });
    let hits = 0;
    s.schedule('alarm', () => hits++, { at: BASE + 5000 });
    assert.strictEqual(s.tick(BASE + 4999).length, 0, 'not yet due');
    assert.deepStrictEqual(s.tick(BASE + 5000), ['alarm'], 'fires at the target');
    assert.strictEqual(hits, 1, 'handler ran once');
    assert.strictEqual(s.pending(), 0, 'one-off removed after firing');
    assert.strictEqual(s.tick(BASE + 9000).length, 0, 'no second fire');
  }

  // 7. recurring {every}: drift-correct targets, oldest-first fire order
  {
    const now = { v: BASE };
    const order = [];
    const s = S.createScheduler({ now: () => now.v, onFire: (n) => order.push(n) });
    s.schedule('a', () => {}, { every: 60000 });
    s.schedule('b', () => {}, { every: 60000, runMissed: 'skip' });
    assert.strictEqual(s.tick(BASE + 60000).length, 2, 'both due at +1m');
    assert.strictEqual(s.tick(BASE + 60001).length, 0, 'nothing mid-interval');
    assert.strictEqual(s.tick(BASE + 120000).length, 2, 'both due at +2m');
    assert.deepStrictEqual(order, ['a', 'b', 'a', 'b'], 'oldest target first, stable');
    assert.ok(s.list().every(t => t.nextRun === BASE + 180000), 'targets anchored, not fire-time');
  }

  // 8. upsert: scheduling the same name replaces the def
  {
    const now = { v: BASE };
    const s = S.createScheduler({ now: () => now.v });
    s.schedule('job', () => {}, { every: 60000 });
    s.schedule('job', () => {}, { at: BASE + 1000 });
    assert.strictEqual(s.pending(), 1, 'one task after upsert');
    assert.deepStrictEqual(s.tick(BASE + 1000), ['job'], 'new def governs');
    assert.strictEqual(s.pending(), 0, 'and it was a one-off');
    assert.ok(!s.cancel('nope'), 'cancel of unknown returns false');
  }

  // 9. missed-run policy across a serialization round-trip
  {
    const clock = { v: BASE };
    const a = S.createScheduler({ now: () => clock.v });
    a.schedule('cron', () => {}, { cron: '0 6 * * *' });
    a.schedule('beat', () => {}, { every: 30000 });
    a.schedule('stale', () => {}, { at: BASE + 1000 });
    const records = a.toJSON();

    clock.v = BASE + 86400000; /* a full day later: the WebView was frozen */
    const b = S.createScheduler({ now: () => clock.v });
    b.fromJSON(records);
    assert.strictEqual(b.pending(), 2, 'stale one-off dropped, 2 restored');
    const cronTask = b.list().find(t => t.name === 'cron');
    const beatTask = b.list().find(t => t.name === 'beat');
    assert.strictEqual(cronTask.nextRun, at(2026, 11, 3, 6, 0), 'skip: cron recomputed from now (next 6am is Nov 3)');
    assert.strictEqual(beatTask.nextRun, clock.v + 30000, 'skip: every resyncs from now');
    /* runMissed once on a STALE task: armed for the next tick instead of skipped */
    const armed = b.schedule('late', () => {}, { at: clock.v - 5000, runMissed: 'once' });
    assert.strictEqual(armed, clock.v, 'once: stale one-off armed for the next tick');
    assert.deepStrictEqual(b.tick(clock.v + 1), ['late'], 'once: fires immediately');
    /* default skip: a stale one-off is silently dropped */
    assert.strictEqual(b.schedule('dropme', () => {}, { at: clock.v - 5000 }), null, 'skip: stale one-off not scheduled');
    assert.strictEqual(b.pending(), 2, 'cron + beat remain');
  }

  // 10. cancel + handler isolation: a throwing fn never breaks the tick loop
  {
    const now = { v: BASE };
    const errors = [];
    const s = S.createScheduler({ now: () => now.v, onError: (e, n) => errors.push(n) });
    s.schedule('bad', () => { throw new Error('boom'); }, { every: 60000 });
    s.schedule('good', () => {}, { every: 60000 });
    const fired = s.tick(BASE + 60000);
    assert.strictEqual(fired.length, 2, 'both fired despite the throw');
    assert.deepStrictEqual(errors, ['bad'], 'onError captured the bad task');
    assert.ok(s.cancel('bad'), 'cancel works');
    assert.strictEqual(s.pending(), 1, 'one left');
    assert.ok(s.stop() === undefined, 'stop is safe without start');
  }

  console.log('scheduler: 10/10 scenarios PASS (cron + next-run + drift + missed-run + persistence)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
