/* REVA — App Framework (original subsystems engine, subsystem #7).
   Wires all subsystems into a cohesive SPA framework the agent's builds
   import as ONE module:
   - RESTORE.createStore: state management
   - RVROUTER.createRouter: client-side routing
   - EVENTBUS.createBus: decoupled communication
   - FETCHCLIENT.createClient: HTTP with retry/cache/interceptors
   - Lifecycle: mount → ready → destroy
   - Plugin system: register capabilities at boot
   - The agent generates: var app = REVA.createApp({ routes, store, … }); app.mount("#root");
   Pure UMD: identical code in node tests and the WebView. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.APPFRAMEWORK = api;
})(typeof window !== 'undefined' ? window : global, function (root) {
  'use strict';

  /* createApp(opts)
     opts: {
       name: 'my-app',
       initialState: { … },
       routes: [{ path, handler, guard? }],
       baseUrl: 'https://api.example.com',
       plugins: [{ name, setup(app) }],
       hash: true (for file:// previews)
     } */
  function createApp(opts) {
    opts = opts || {};
    var STORE = root.RESTORE || (typeof require === 'function' && require('./store.js'));
    var ROUTER = root.RVROUTER || (typeof require === 'function' && require('./router.js'));
    var BUS = root.EVENTBUS || (typeof require === 'function' && require('./eventbus.js'));
    var FETCH = root.FETCHCLIENT || (typeof require === 'function' && require('./fetchclient.js'));
    var SCHED = root.SCHEDULER || (typeof require === 'function' && require('./scheduler.js'));
    var I18N = root.I18N || (typeof require === 'function' && require('./i18n.js'));

    var bus = BUS.createBus({ handlerErrors: 'log' });
    var scopedBus = bus.scope(opts.name || 'app');
    var store = STORE.createStore(opts.initialState || {}, { name: opts.name || 'app' });
    var plugins = [];
    var mounted = false;
    var destroyed = false;

    var fetchClient = null;
    if (FETCH) {
      fetchClient = FETCH.createClient({
        baseUrl: opts.baseUrl || '',
        timeout: opts.timeout || 15000,
        retries: opts.retries !== undefined ? opts.retries : 2
      });
    }

    var router = null;
    if (ROUTER && opts.routes) {
      router = ROUTER.createRouter({
        routes: opts.routes,
        hash: opts.hash !== undefined ? opts.hash : true,
        notFound: opts.notFound || null
      });
    }

    var i18n = null;
    if (I18N && opts.i18n) {
      i18n = I18N.createI18n({
        locale: opts.i18n.locale || 'en',
        fallback: opts.i18n.fallback || 'en',
        catalogs: opts.i18n.catalogs || {}
      });
    }

    var app = {
      name: opts.name || 'app',
      bus: scopedBus,
      globalBus: bus,
      store: store,
      router: router,
      fetch: fetchClient,
      mounted: false,

      /* scheduler: deferred + recurring work (goal-loop follow-ups, chores).
         createScheduler shares the app's error policy: throws land on the bus. */
      schedule: function (name, def, fn) {
        if (!app.scheduler) {
          if (!SCHED) return null;
          app.scheduler = SCHED.createScheduler({
            onError: function (err, taskName) { scopedBus.emit('scheduler:error', { task: taskName, error: err.message }); }
          });
        }
        return app.scheduler.schedule(name, fn, def);
      },
      cancelScheduled: function (name) { return app.scheduler ? app.scheduler.cancel(name) : false; },

      /* i18n: catalogs from opts.i18n {locale, fallback, catalogs}. Without
         the engine, t() is the identity (honest pass-through, no crashes). */
      t: function (key, params) { return i18n ? i18n.t(key, params) : key; },
      plural: function (key, count, params) { return i18n ? i18n.plural(key, count, params) : key; },
      setLocale: function (loc) { if (i18n) i18n.setLocale(loc); },
      getLocale: function () { return i18n ? i18n.getLocale() : (opts.i18n && opts.i18n.locale) || 'en'; },

      /* plugin registration */
      register: function (plugin) {
        plugins.push(plugin);
        if (mounted && plugin.setup) {
          try { plugin.setup(app); } catch (e) {
            if (typeof console !== 'undefined') console.error('[plugin:' + plugin.name + ']', e.message);
          }
        }
        return app;
      },

      /* mount(el): attach the router, run plugins, mark as ready */
      mount: function (selector) {
        if (destroyed) return app;
        if (router && typeof selector === 'string' && typeof document !== 'undefined') {
          router.mount(selector);
        }
        plugins.forEach(function (p) {
          if (p.setup) {
            try { p.setup(app); }
            catch (e) {
              if (typeof console !== 'undefined') console.error('[plugin:' + p.name + ']', e.message);
            }
          }
        });
        mounted = true;
        scopedBus.emit('mounted', { name: app.name });
        return app;
      },

      /* destroy: emit the event BEFORE clearing the listeners */
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        if (fetchClient) fetchClient.abortAll();
        scopedBus.emit('destroyed', { name: app.name });
        bus.clear();
      },

      /* state shortcuts */
      getState: function () { return store.getState(); },
      setState: function (patch, actionName) { return store.set(patch, actionName); },
      subscribe: function (fn) { return store.subscribe(fn); },

      /* emit on the scoped bus (relays to the global bus automatically) */
      emit: function (name, data) { scopedBus.emit(name, data); },

      /* is the app mounted? */
      isMounted: function () { return mounted; }
    };

    return app;
  }

  /* the version — for debugging and compatibility checks */
  var VERSION = '1.0.0';

  return {
    createApp: createApp,
    VERSION: VERSION
  };
});
