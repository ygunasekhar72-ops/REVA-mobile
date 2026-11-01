/* REVA — Router (original subsystems engine, subsystem #5).
   A client-side router for SPAs the agent builds:
   - route table: [{path: '/game/:id', handler: fn, guard: fn?, name: 'game'}]
   - params: :id (single segment), *rest (multi-segment)
   - guards: async pre-navigation checks → redirect or block
   - lifecycle: onBeforeNavigate, onAfterNavigate, onNavigateError
   - race protection: only the LATEST navigation renders (generation token)
   - history API + hash fallback (auto-detected)
   - link interception: clicks on [data-nav] routes without page reload
   Pure UMD: identical code in node tests and the WebView. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RVROUTER = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  /* compilePath('/game/:id', '/docs/*rest') → {regex, keys}
     :name captures one segment; *name captures everything after (greedy) */
  function compilePath(pattern) {
    var keys = [];
    var regexStr = '';
    var segs = String(pattern).split('/');
    for (var i = 0; i < segs.length; i++) {
      if (i > 0) regexStr += '/';
      var seg = segs[i];
      if (seg.indexOf(':') === 0 && seg.length > 1) {
        keys.push(seg.slice(1));
        regexStr += '([^/]+)';
      } else if (seg.indexOf('*') === 0 && seg.length > 1) {
        keys.push(seg.slice(1));
        regexStr += '(.*)';
      } else if (seg === '*') {
        /* bare * — unnamed wildcard, still captures */
        keys.push('wildcard');
        regexStr += '(.*)';
      } else {
        regexStr += seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
    }
    return { regex: new RegExp('^' + regexStr + '$'), keys: keys };
  }

  function matchRoute(routes, pathname) {
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i];
      var c = compilePath(r.path);
      var m = c.regex.exec(pathname);
      if (m) {
        var params = {};
        c.keys.forEach(function (key, ix) { params[key] = decodeURIComponent(m[ix + 1]); });
        return { route: r, params: params };
      }
    }
    return null;
  }

  function extractQuery(search) {
    var q = {};
    if (!search || search === '?') return q;
    search.slice(1).split('&').forEach(function (pair) {
      if (!pair) return;
      var eq = pair.indexOf('=');
      var key = eq >= 0 ? pair.slice(0, eq) : pair;
      var val = eq >= 0 ? pair.slice(eq + 1) : '';
      try { q[decodeURIComponent(key)] = decodeURIComponent(val); } catch (e) { q[key] = val; }
    });
    return q;
  }

  function createRouter(opts) {
    opts = opts || {};
    var routes = opts.routes || [];
    var notFound = opts.notFound || null;
    var hooks = { before: [], after: [], error: [] };
    var currentNav = 0; // generation token — only the latest navigation renders
    var currentRoute = null;
    var useHash = opts.hash === undefined ? (typeof location !== 'undefined' && (location.protocol === 'file:' || !window.history || !window.history.pushState)) : opts.hash;
    var container = null;

    var router = {};

    /* navigate(path, opts): the ONLY entry point — guards → handler */
    router.navigate = function (path, opts2) {
      opts2 = opts2 || {};
      var gen = ++currentNav;
      /* match against the path DIRECTLY — the URL construction is for the
         address bar only, not for matching (hash mode strips the path) */
      var cleanPath = path.split('?')[0] || '/';
      var queryStr = path.indexOf('?') >= 0 ? '?' + path.split('?')[1] : '';
      var query = extractQuery(queryStr);
      var pathname = cleanPath;

      var match = matchRoute(routes, pathname);
      if (!match) {
        if (notFound) { notFound(pathname, query); return; }
        if (hooks.error.length) { hooks.error.forEach(function (h) { h(new Error('no route for ' + pathname), pathname); }); return; }
        return;
      }

      var route = match.route, params = match.params;

      function proceed() {
        if (gen !== currentNav) return; // a newer navigation superseded this one
        /* leave hook for the outgoing route */
        if (currentRoute && currentRoute.onLeave) currentRoute.onLeave(currentRoute, params);
        currentRoute = route;
        if (useHash && typeof location !== 'undefined' && !opts2.silent) {
          location.hash = path;
        } else if (!useHash && typeof history !== 'undefined' && history.pushState && !opts2.silent) {
          history.pushState({ gen: gen }, '', path);
        }
        hooks.before.forEach(function (h) { h(route, params, query); });
        route.handler({ params: params, query: query, path: pathname, route: route });
        hooks.after.forEach(function (h) { h(route, params, query); });
      }

      /* guards: sync guards resolve synchronously; async guards (returning
         a Promise) resolve in a microtask — both paths are race-protected */
      if (route.guard) {
        var guardResult = route.guard({ params: params, query: query, path: pathname });
        if (guardResult && typeof guardResult.then === 'function') {
          guardResult.then(function (result) {
            if (gen !== currentNav) return;
            processGuardResult(result, gen);
          }).catch(function (e) {
            hooks.error.forEach(function (h) { h(e, pathname); });
          });
        } else {
          processGuardResult(guardResult, gen);
        }
      } else {
        proceed();
      }
    }

    function processGuardResult(result, gen) {
      if (gen !== currentNav) return;
      if (result === false) return;
      if (typeof result === 'string') { router.navigate(result); return; }
      proceed();
    }

    /* on/hook registration */
    router.onBeforeNavigate = function (fn) { hooks.before.push(fn); return function () { hooks.before = hooks.before.filter(function (h) { return h !== fn; }); }; };
    router.onAfterNavigate = function (fn) { hooks.after.push(fn); return function () { hooks.after = hooks.after.filter(function (h) { return h !== fn; }); }; };
    router.onNavigateError = function (fn) { hooks.error.push(fn); return function () { hooks.error = hooks.error.filter(function (h) { return h !== fn; }); }; };

    /* mount(container): attach to the DOM — popstate/hashchange + click interception */
    router.mount = function (el) {
      container = el;
      if (typeof window === 'undefined') return;
      if (useHash) {
        window.addEventListener('hashchange', function () {
          router.navigate(location.hash.slice(1) || '/', { silent: true });
        });
      } else {
        window.addEventListener('popstate', function (e) {
          router.navigate(location.pathname + (location.search || ''), { silent: true });
        });
      }
      /* click interception for [data-nav] links */
      document.addEventListener('click', function (e) {
        var link = e.target.closest ? e.target.closest('[data-nav]') : null;
        if (!link || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        router.navigate(link.getAttribute('href') || link.getAttribute('data-nav'));
      });
      /* initial navigation */
      var initial = useHash ? (location.hash.slice(1) || '/') : (location.pathname + (location.search || ''));
      router.navigate(initial, { silent: true });
    };

    router.match = function (path) { return matchRoute(routes, path); };
    router.getCurrentRoute = function () { return currentRoute; };
    router.addRoute = function (route) { routes.push(route); };
    router.getRoutes = function () { return routes.slice(); };
    router.isHash = function () { return useHash; };

    return router;
  }

  return {
    createRouter: createRouter,
    compilePath: compilePath,
    matchRoute: matchRoute,
    extractQuery: extractQuery
  };
});
