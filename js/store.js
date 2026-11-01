/* REVA — Reactive Store (original subsystems engine, subsystem #4).
   A vanilla state-management store the agent can import into its builds:
   - immutable set (Object.assign patch) with batched notify
   - selectors: get(selectorFn) reads derived state
   - subscribe(listener) → unsubscribe (eventbus contract)
   - computed: memoized derived values keyed by input reference
   - middleware: intercept set() (logging, persistence, validation)
   - actions: named update functions registered on the store
   - devtools: optional time-travel via snapshot history
   Pure UMD: identical code in node tests and the WebView. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RESTORE = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  /* createStore(initial, opts)
     opts: { name, middleware: [fn(action, state) → state|null], maxHistory } */
  function createStore(initial, opts) {
    opts = opts || {};
    var state = deepFreeze(initial || {});
    var listeners = new Set();
    var middleware = opts.middleware || [];
    var history = [{ action: '@init', state: state, ts: Date.now() }];
    var maxHistory = opts.maxHistory || 50;
    var notifyQueued = false;
    var computeds = new Map(); // selector fn → {lastInput, lastOutput}
    var actions = {};

    function deepFreeze(obj) {
      if (typeof obj !== 'object' || obj === null) return obj;
      Object.keys(obj).forEach(function (k) { deepFreeze(obj[k]); });
      return Object.freeze(obj);
    }

    function getState() { return state; }

    /* set(patch, actionName): immutable update + batched notify */
    function set(patch, actionName) {
      var prev = state;
      var next = Object.assign({}, state, patch);
      /* run middleware chain — each middleware can transform or veto (return null) */
      for (var m = 0; m < middleware.length; m++) {
        var result = middleware[m]({ action: actionName || 'set', prev: prev, next: next });
        if (result === null) return state; // vetoed
        if (result && result !== next) next = result;
      }
      state = deepFreeze(next);
      /* snapshot for time-travel */
      history.push({ action: actionName || 'set', state: state, ts: Date.now() });
      if (history.length > maxHistory) history.shift();
      /* batched notify — multiple set() calls in one handler = one render */
      if (!notifyQueued) {
        notifyQueued = true;
        Promise.resolve().then(function () {
          notifyQueued = false;
          listeners.forEach(function (l) {
            try { l(state); } catch (e) {
              if (typeof console !== 'undefined') console.error('[store:' + (opts.name || '?') + ']', e.message || e);
            }
          });
        });
      }
      invalidateComputeds();
      return state;
    }

    function subscribe(listener) {
      listeners.add(listener);
      return function () { listeners.delete(listener); };
    }

    /* get(selector): read derived state — plain read */
    function get(selector) {
      return selector ? selector(state) : state;
    }

    /* computed(selector): memoized derived — re-evaluates only when the
       state reference changes (immutable updates make reference equality
       a reliable dirty check). */
    function computed(selector) {
      var entry = computeds.get(selector);
      if (!entry || entry.lastInput !== state) {
        entry = { lastInput: state, lastOutput: selector(state) };
        computeds.set(selector, entry);
      }
      return entry.lastOutput;
    }

    function invalidateComputeds() {
      computeds.clear();
    }

    /* action(name, fn): register a named update — fn(draft, patch) returns a patch */
    function action(name, fn) {
      actions[name] = function () {
        var patch = fn.apply(null, arguments);
        if (patch) set(patch, name);
        return state;
      };
      return actions[name];
    }

    function getActions() { return actions; }

    /* history: time-travel for devtools */
    function getHistory() { return history.slice(); }
    function jumpTo(index) {
      if (index < 0 || index >= history.length) return state;
      state = history[index].state;
      invalidateComputeds();
      listeners.forEach(function (l) { try { l(state); } catch (e) { } });
      return state;
    }

    return {
      getState: getState,
      set: set,
      subscribe: subscribe,
      get: get,
      computed: computed,
      action: action,
      getActions: getActions,
      getHistory: getHistory,
      jumpTo: jumpTo,
      name: opts.name || 'store'
    };
  }

  /* createStoreFromJSON(snapshot): restore a serialized store (save-systems) */
  function createStoreFromJSON(snapshot, opts) {
    var data = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
    return createStore(data.state || data, opts);
  }

  /* combineStores({ name: store, … }): a meta-store for multi-store apps */
  function combineStores(stores) {
    var names = Object.keys(stores);
    var subs = [];
    var meta = {
      getState: function () {
        var out = {};
        names.forEach(function (n) { out[n] = stores[n].getState(); });
        return out;
      },
      subscribe: function (l) {
        var unsubs = names.map(function (n) { return stores[n].subscribe(l); });
        return function () { unsubs.forEach(function (u) { u(); }); };
      },
      get: function (storeName, selector) {
        return stores[storeName] ? stores[storeName].get(selector) : undefined;
      }
    };
    return meta;
  }

  return {
    createStore: createStore,
    createStoreFromJSON: createStoreFromJSON,
    combineStores: combineStores
  };
});
