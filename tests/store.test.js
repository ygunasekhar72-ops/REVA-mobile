/* Unit test: the Reactive Store (js/store.js) — subsystem #4.
   Immutable updates, batched notify, selectors, computed, middleware,
   actions, time-travel history, combine. */
'use strict';
const assert = require('assert');
const S = require('../js/store.js');

(async () => {
  // 1. create + get: initial state is frozen
  var store = S.createStore({ count: 0, items: [] }, { name: 'test' });
  assert.deepStrictEqual(store.getState(), { count: 0, items: [] });
  assert.ok(Object.isFrozen(store.getState()), 'state is frozen');

  // 2. set: immutable patch — the old reference is preserved
  var prev = store.getState();
  store.set({ count: 1 });
  assert.strictEqual(store.getState().count, 1);
  assert.strictEqual(prev.count, 0, 'old reference untouched');
  assert.ok(store.getState() !== prev, 'new reference after set');

  // 3. subscribe/unsubscribe: batched notify
  var notifications = 0;
  var unsub = store.subscribe(function () { notifications++; });
  store.set({ count: 2 });
  store.set({ count: 3 });
  /* batched: both sets in the same microtask → ONE notification */
  await new Promise(r => setTimeout(r, 10));
  assert.ok(notifications <= 2, 'batched notify (got ' + notifications + ')');
  unsub();
  store.set({ count: 4 });
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(store.getState().count, 4, 'state updated after unsub');
  var after = notifications;
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(notifications, after, 'no notification after unsub');

  // 4. get(selector): derived read
  store.set({ items: ['a', 'b', 'c'] });
  var active = store.get(function (s) { return s.items.filter(Boolean); });
  assert.deepStrictEqual(active, ['a', 'b', 'c'], 'selector read');

  // 5. computed: memoized — the same state reference returns the cached value
  var computeCalls = 0;
  var selector = function (s) { computeCalls++; return s.items.length; };
  var result1 = store.computed(selector);
  var result2 = store.computed(selector); // same state ref → cached
  assert.strictEqual(result1, result2, 'same result');
  assert.strictEqual(computeCalls, 1, 'computed cached (got ' + computeCalls + ' calls)');
  store.set({ count: 5 }); // state changes → computed invalidated
  var result3 = store.computed(selector);
  assert.strictEqual(computeCalls, 2, 'recomputed after set');

  // 6. middleware: logging + veto
  var log = [];
  var store2 = S.createStore({ n: 0 }, {
    name: 'logged',
    middleware: [
      function (info) { log.push(info.action + ':' + JSON.stringify(info.next)); return info.next; },
      function (info) { if (info.next.n < 0) return null; return info.next; } // veto negatives
    ]
  });
  store2.set({ n: 5 }, 'positive');
  store2.set({ n: -1 }, 'negative');
  assert.strictEqual(store2.getState().n, 5, 'negative set vetoed');
  assert.ok(log.length >= 1 && log[0].indexOf('positive') >= 0, 'middleware log');

  // 7. actions: named updates
  var store3 = S.createStore({ todos: [] });
  store3.action('addTodo', function (text) { return { todos: store3.getState().todos.concat([text]) }; });
  store3.getActions().addTodo('write tests');
  assert.deepStrictEqual(store3.getState().todos, ['write tests'], 'action applied');

  // 8. time-travel: history + jumpTo
  var store4 = S.createStore({ step: 0 }, { maxHistory: 100 });
  store4.set({ step: 1 }, 'step-1');
  store4.set({ step: 2 }, 'step-2');
  store4.set({ step: 3 }, 'step-3');
  var hist = store4.getHistory();
  assert.strictEqual(hist.length, 4, '4 snapshots (initial + 3)');
  store4.jumpTo(1);
  assert.strictEqual(store4.getState().step, 1, 'jumped back to step 1');
  store4.jumpTo(3);
  assert.strictEqual(store4.getState().step, 3, 'jumped forward');

  // 9. createStoreFromJSON: serialization roundtrip
  var snapshot = JSON.stringify({ state: { name: 'restored', value: 42 } });
  var store5 = S.createStoreFromJSON(snapshot);
  assert.strictEqual(store5.getState().value, 42, 'deserialized');

  // 10. combineStores: multi-store meta
  var sA = S.createStore({ x: 1 });
  var sB = S.createStore({ y: 2 });
  var combined = S.combineStores({ a: sA, b: sB });
  assert.deepStrictEqual(combined.getState(), { a: { x: 1 }, b: { y: 2 } }, 'combined state');
  assert.strictEqual(combined.get('b', s => s.y), 2, 'per-store selector');

  // 11. deep freeze: nested objects are also frozen
  var store6 = S.createStore({ nested: { deep: { value: 1 } } });
  assert.ok(Object.isFrozen(store6.getState().nested), 'nested frozen');
  assert.ok(Object.isFrozen(store6.getState().nested.deep), 'deep nested frozen');

  console.log('store: 11/11 scenarios PASS (immutable + batched + computed + middleware + time-travel)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
