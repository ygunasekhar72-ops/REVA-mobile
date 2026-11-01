/* Unit test: the REVA Event Bus (js/eventbus.js) — typed scoped pub/sub.
   Subscribe/unsubscribe, once, wildcard, emit safety, scoping, teardown. */
'use strict';
const assert = require('assert');
const EB = require('../js/eventbus.js');

(async () => {
  // 1. on/emit: basic subscribe → fire → receive
  var bus = EB.createBus();
  var got = null;
  bus.on('test:event', function (data) { got = data; });
  bus.emit('test:event', { value: 42 });
  assert.deepStrictEqual(got, { value: 42 }, 'basic pub/sub');

  // 2. unsubscribe: the returned function removes the listener
  var calls = 0;
  var off = bus.on('test:count', function () { calls++; });
  bus.emit('test:count', {});
  assert.strictEqual(calls, 1, 'fired once');
  off();
  bus.emit('test:count', {});
  assert.strictEqual(calls, 1, 'unsubscribed — no second fire');

  // 3. once: fires exactly once then auto-unsubscribes
  var onceCalls = 0;
  bus.once('test:once', function () { onceCalls++; });
  bus.emit('test:once', {});
  bus.emit('test:once', {});
  bus.emit('test:once', {});
  assert.strictEqual(onceCalls, 1, 'once fires exactly once');

  // 4. emit safety: unsubscribing mid-emit does not skip neighbors
  var order = [];
  var bus2 = EB.createBus();
  var offMid = bus2.on('seq', function () { order.push('a'); offMid(); });
  bus2.on('seq', function () { order.push('b'); });
  bus2.emit('seq', {});
  assert.deepStrictEqual(order, ['a', 'b'], 'mid-emit unsub does not skip b');
  bus2.emit('seq', {});
  assert.deepStrictEqual(order, ['a', 'b', 'b'], 'second emit: only b fires');

  // 5. handler isolation: a throwing handler does not kill the emit loop
  var bus3 = EB.createBus();
  var ranAfter = false;
  bus3.on('crash', function () { throw new Error('boom'); });
  bus3.on('crash', function () { ranAfter = true; });
  bus3.emit('crash', {}); // must not throw out of emit
  assert.ok(ranAfter, 'second handler ran after the first crashed');

  // 5b. throw mode: handlerErrors = 'throw' propagates
  var bus3t = EB.createBus({ handlerErrors: 'throw' });
  bus3t.on('crash', function () { throw new Error('propagated'); });
  assert.throws(function () { bus3t.emit('crash', {}); }, /propagated/, 'throw mode propagates');

  // 6. wildcard: on('*:changed') fires for any event ending in ':changed'
  var wildEvents = [];
  var bus4 = EB.createBus();
  bus4.on('*:changed', function (data, name) { wildEvents.push(name); });
  bus4.on('file:changed', function () { });
  bus4.on('skill:changed', function () { });
  bus4.on('unrelated', function () { });
  bus4.emit('file:changed', {});
  bus4.emit('skill:changed', {});
  bus4.emit('unrelated', {});
  assert.deepStrictEqual(wildEvents, ['file:changed', 'skill:changed'], 'wildcard matches suffix only');

  // 7. scope: namespaced child with parent relay
  var bus5 = EB.createBus();
  var child = bus5.scope('ide');
  var parentSaw = null;
  bus5.on('ide:saved', function (data) { parentSaw = data; });
  var childSaw = null;
  child.on('saved', function (data) { childSaw = data; });
  child.emit('saved', { file: 'app.js' });
  assert.deepStrictEqual(childSaw, { file: 'app.js' }, 'child listener fired');
  assert.deepStrictEqual(parentSaw, { file: 'app.js' }, 'parent relayed as ide:saved');

  // 8. scoped bus isolation: two scopes do not cross-fire
  var childA = bus5.scope('agent');
  var childB = bus5.scope('tools');
  var aFired = false, bFired = false;
  childA.on('done', function () { aFired = true; });
  childB.on('done', function () { bFired = true; });
  childA.emit('done', {});
  assert.ok(aFired && !bFired, 'scoped buses are isolated');

  // 9. listenerCount + clear
  var bus6 = EB.createBus();
  bus6.on('a', function () { });
  bus6.on('a', function () { });
  bus6.on('b', function () { });
  assert.strictEqual(bus6.listenerCount('a'), 2, 'count per event');
  assert.strictEqual(bus6.listenerCount(), 3, 'total count');
  bus6.clear('a');
  assert.strictEqual(bus6.listenerCount('a'), 0, 'clear per event');
  bus6.clear();
  assert.strictEqual(bus6.listenerCount(), 0, 'clear all');

  // 10. returns cleanup that is safe to call twice
  var off2 = bus6.on('safe', function () { });
  off2();
  off2(); // double-unsubscribe must not throw
  assert.ok(true, 'double-unsubscribe safe');

  console.log('eventbus: 10/10 scenarios PASS (pub/sub + wildcards + scoping + isolation)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
