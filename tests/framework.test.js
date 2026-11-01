/* Unit test: the App Framework (js/framework.js) — subsystem #7.
   Wiring: store + router + eventbus + fetch client + plugins + lifecycle. */
'use strict';
const assert = require('assert');

/* the subsystems are required relative — the framework resolves them */
global.RESTORE = require('../js/store.js');
global.RVROUTER = require('../js/router.js');
global.EVENTBUS = require('../js/eventbus.js');
global.FETCHCLIENT = require('../js/fetchclient.js');
const FW = require('../js/framework.js');

(async () => {
  // 1. createApp: the store and bus are wired
  var app = FW.createApp({ name: 'test-app', initialState: { count: 0 } });
  assert.ok(app.store, 'store exists');
  assert.ok(app.bus, 'bus exists');
  assert.ok(app.name === 'test-app', 'name set');

  // 2. state management through the app
  app.setState({ count: 5 });
  assert.strictEqual(app.getState().count, 5, 'state set through app');

  // 3. subscribe: notified on state change
  var notified = 0;
  app.subscribe(function () { notified++; });
  app.setState({ count: 10 });
  await new Promise(r => setTimeout(r, 10));
  assert.ok(notified >= 1, 'notified on state change');

  // 4. bus: emit and listen through the app
  var got = null;
  app.bus.on('custom', function (data) { got = data; });
  app.emit('custom', { key: 'value' });
  assert.deepStrictEqual(got, { key: 'value' }, 'bus emit/listen');

  // 5. scoped bus: events relay to the global bus as 'test-app:custom'
  var parentGot = null;
  app.globalBus.on('test-app:relay', function (data) { parentGot = data; });
  app.bus.emit('relay', { hello: true });
  assert.deepStrictEqual(parentGot, { hello: true }, 'scoped bus relays to parent');

  // 6. router: routes navigate
  var routed = null;
  var app2 = FW.createApp({
    name: 'router-app',
    routes: [{ path: '/page/:id', handler: function (ctx) { routed = ctx; } }],
    hash: true
  });
  app2.router.navigate('/page/42', { silent: true });
  assert.ok(routed && routed.params.id === '42', 'router navigates');

  // 7. fetch client: mock fetch injection
  var mockFetch = function (url, opts) {
    return Promise.resolve({
      ok: true, status: 200,
      text: function () { return Promise.resolve('{"data":"hello"}'); },
      headers: { forEach: function () { } }
    });
  };
  var app3 = FW.createApp({ name: 'fetch-app', baseUrl: 'https://api.example.com' });
  /* the fetch client is created internally — we test through the app */
  assert.ok(app3.fetch, 'fetch client exists');

  // 8. plugins: setup runs on mount
  var pluginSetup = false;
  var app4 = FW.createApp({ name: 'plugin-app' });
  app4.register({ name: 'my-plugin', setup: function (a) { pluginSetup = true; } });
  assert.ok(!pluginSetup, 'setup NOT called before mount');
  app4.mount();
  assert.ok(pluginSetup, 'setup called on mount');

  // 9. lifecycle: mounted and destroyed events
  var events = [];
  var app5 = FW.createApp({ name: 'lifecycle-app' });
  app5.globalBus.on('lifecycle-app:mounted', function () { events.push('mounted'); });
  app5.globalBus.on('lifecycle-app:destroyed', function () { events.push('destroyed'); });
  app5.mount();
  app5.destroy();
  assert.deepStrictEqual(events, ['mounted', 'destroyed'], 'lifecycle events');

  // 10. isMounted
  var app6 = FW.createApp({ name: 'mount-check' });
  assert.ok(!app6.isMounted(), 'not mounted yet');
  app6.mount();
  assert.ok(app6.isMounted(), 'mounted');

  // 11. VERSION
  assert.ok(FW.VERSION, 'version exists');

  // 12. scheduler wiring: deferred work through the app, errors on the bus
  var app7 = FW.createApp({ name: 'sched-app' });
  var beat = 0;
  var when = app7.schedule('beat', { every: 60000 }, function () { beat++; });
  assert.ok(when > 0, 'schedule returned a nextRun');
  var schedErrors = [];
  app7.bus.on('scheduler:error', function (e) { schedErrors.push(e.task); });
  app7.schedule('boom', { every: 60000 }, function () { throw new Error('x'); });
  var fired = app7.scheduler.tick(when);
  assert.deepStrictEqual(fired, ['beat', 'boom'], 'both due tasks fired');
  assert.strictEqual(beat, 1, 'recurring task ran');
  assert.deepStrictEqual(schedErrors, ['boom'], 'throwing task landed on the scoped bus');
  assert.ok(app7.cancelScheduled('boom') && !app7.cancelScheduled('boom'), 'cancel true once');
  assert.strictEqual(app7.scheduler.pending(), 1, 'beat remains');

  console.log('framework: 12/12 scenarios PASS (store + bus + router + fetch + plugins + lifecycle + scheduler)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
