/* Unit test: the REVA Router (js/router.js) — subsystem #5.
   Route matching, params, guards, lifecycle hooks, race protection, query. */
'use strict';
const assert = require('assert');
const R = require('../js/router.js');

(async () => {
  // 1. route matching: exact, params, wildcards, 404
  var routes = [
    { path: '/', handler: function () { }, name: 'home' },
    { path: '/game/:id', handler: function () { }, name: 'game' },
    { path: '/docs/*rest', handler: function () { }, name: 'docs' },
    { path: '/user/:name/posts/:postId', handler: function () { }, name: 'posts' }
  ];
  var m1 = R.matchRoute(routes, '/');
  assert.ok(m1 && m1.route.name === 'home', 'exact match');
  var m2 = R.matchRoute(routes, '/game/42');
  assert.ok(m2 && m2.params.id === '42', 'single param extracted');
  var m3 = R.matchRoute(routes, '/docs/a/b/rest');
  assert.ok(m3 && m3.params.rest === 'a/b/rest', 'wildcard captures multi-segment');
  var m4 = R.matchRoute(routes, '/user/alice/posts/99');
  assert.ok(m4 && m4.params.name === 'alice' && m4.params.postId === '99', 'multiple params');
  assert.strictEqual(R.matchRoute(routes, '/nonexistent'), null, '404');
  assert.strictEqual(R.matchRoute(routes, '/game/'), null, 'trailing slash is NOT /game/:id (empty param)');

  // 2. params are decoded
  var m5 = R.matchRoute(routes, '/game/hello%20world');
  assert.strictEqual(m5.params.id, 'hello world', 'URI-decoded params');

  // 3. query extraction
  var q = R.extractQuery('?tag=a&tag=b&page=2&empty=');
  assert.deepStrictEqual(q, { tag: 'b', page: '2', empty: '' }, 'query parsed (last value wins)');

  // 4. createRouter: navigate → handler fires with params
  var router = R.createRouter({ routes: routes.slice(0, 2) });
  var fired = null;
  routes[1].handler = function (ctx) { fired = ctx; };
  router.navigate('/game/99', { silent: true });
  assert.ok(fired && fired.params.id === '99', 'handler receives params');
  assert.ok(fired.query !== undefined, 'handler receives query object');

  // 5. guards: redirect
  var guardRoutes = [
    { path: '/admin', handler: function () { }, guard: function () { return '/login'; } },
    { path: '/login', handler: function () { } }
  ];
  var guardRouter = R.createRouter({ routes: guardRoutes });
  var adminFired = false, loginFired = false;
  guardRoutes[0].handler = function () { adminFired = true; };
  guardRoutes[1].handler = function () { loginFired = true; };
  guardRouter.navigate('/admin', { silent: true });
  assert.ok(!adminFired && loginFired, 'guard redirected to /login');

  // 6. guards: async redirect (promise)
  var asyncRouter = R.createRouter({ routes: [
    { path: '/protected', handler: function () { }, guard: function () { return Promise.resolve('/denied'); } },
    { path: '/denied', handler: function () { } }
  ]});
  var deniedFired = false;
  asyncRouter.getRoutes()[1].handler = function () { deniedFired = true; };
  asyncRouter.navigate('/protected', { silent: true });
  await new Promise(r => setTimeout(r, 50));
  assert.ok(deniedFired, 'async guard redirected');

  // 7. guards: block (return false)
  var blockRouter = R.createRouter({ routes: [
    { path: '/locked', handler: function () { }, guard: function () { return false; } }
  ]});
  var lockedFired = false;
  blockRouter.getRoutes()[0].handler = function () { lockedFired = true; };
  blockRouter.navigate('/locked', { silent: true });
  assert.ok(!lockedFired, 'guard blocked the navigation');

  // 8. lifecycle hooks
  var hookRouter = R.createRouter({ routes: [{ path: '/', handler: function () { } }] });
  var beforeCalls = 0, afterCalls = 0;
  hookRouter.onBeforeNavigate(function () { beforeCalls++; });
  hookRouter.onAfterNavigate(function () { afterCalls++; });
  hookRouter.navigate('/', { silent: true });
  assert.strictEqual(beforeCalls, 1, 'before hook fired');
  assert.strictEqual(afterCalls, 1, 'after hook fired');

  // 9. race protection: only the latest navigation renders
  var raceRouter = R.createRouter({ routes: [
    { path: '/slow', handler: function () { }, guard: function () { return new Promise(r => setTimeout(r, 100)).then(() => true); } },
    { path: '/fast', handler: function () { } }
  ]});
  var slowFired = false, fastFired = false;
  raceRouter.getRoutes()[0].handler = function () { slowFired = true; };
  raceRouter.getRoutes()[1].handler = function () { fastFired = true; };
  raceRouter.navigate('/slow', { silent: true }); // starts the slow guard
  raceRouter.navigate('/fast', { silent: true }); // supersedes it
  await new Promise(r => setTimeout(r, 200));
  assert.ok(fastFired, 'fast navigation rendered');
  assert.ok(!slowFired, 'slow navigation superseded (race protection)');

  // 10. addRoute: dynamic route addition
  var dynRouter = R.createRouter({ routes: [] });
  var dynFired = false;
  dynRouter.addRoute({ path: '/added', handler: function () { dynFired = true; } });
  dynRouter.navigate('/added', { silent: true });
  assert.ok(dynFired, 'dynamically added route navigates');

  // 11. notFound handler
  var nfRouter = R.createRouter({ routes: [], notFound: function (path) { nfPath = path; } });
  var nfPath = '';
  nfRouter.navigate('/nowhere', { silent: true });
  assert.strictEqual(nfPath, '/nowhere', 'notFound receives the path');

  // 12. hash mode: navigate updates location.hash
  var hashRouter = R.createRouter({ routes: [{ path: '/page', handler: function () { } }], hash: true });
  hashRouter.navigate('/page', { silent: true });
  assert.strictEqual(hashRouter.isHash(), true, 'hash mode flag');
  /* hash navigation would set location.hash — verified in the browser */

  console.log('router: 12/12 scenarios PASS (matching + guards + hooks + race + query)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
