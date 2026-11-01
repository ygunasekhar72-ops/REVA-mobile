/* REVA — Event Bus (original subsystems engine, subsystem #3).
   Typed, scoped pub/sub that decouples the IDE, agent loop, and tools:
   - on(name, fn) → unsubscribe function (the cleanup contract)
   - once(name, fn) — auto-unsubscribes after first fire
   - emit(name, data) — iterates a COPY of the handler set (mid-emit
     unsubscribes never skip neighbors)
   - scope(name) — namespaced child bus (ide:*, agent:*, tools:*)
   - wildcard listeners: on('*:changed', fn) fires for any event ending
     in ':changed' — for dev-mode logging and persistence bridges
   - handlerErrors: 'log' (default) | 'throw' — a throwing handler never
     kills the emit loop in log mode
   Pure UMD: identical code in node tests and the WebView. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EVENTBUS = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  function createBus(opts) {
    opts = opts || {};
    var handlerErrors = opts.handlerErrors || 'log';
    var handlers = {};  // name → Set(fn)
    var wildcards = []; // [{suffix, fn}] — for '*:changed' patterns
    var bus = {};

    function ensureSet(name) {
      if (!handlers[name]) handlers[name] = new Set();
      return handlers[name];
    }

    /* on(name, fn) → unsubscribe */
    bus.on = function (name, fn) {
      if (typeof name !== 'string' || typeof fn !== 'function') return function () {};
      if (name.indexOf('*:') === 0) {
        var suffix = name.slice(1); // ':changed'
        var entry = { suffix: suffix, fn: fn };
        wildcards.push(entry);
        return function () {
          var ix = wildcards.indexOf(entry);
          if (ix >= 0) wildcards.splice(ix, 1);
        };
      }
      var set = ensureSet(name);
      set.add(fn);
      return function () { set.delete(fn); };
    };

    /* once(name, fn) — auto-unsubscribes after the first fire */
    bus.once = function (name, fn) {
      var wrapped = function (data) { off(); fn(data); };
      var off = bus.on(name, wrapped);
      return off;
    };

    /* emit(name, data) — safe iteration (copy), handler isolation */
    bus.emit = function (name, data) {
      var set = handlers[name];
      if (set && set.size) {
        Array.from(set).forEach(function (fn) {
          try { fn(data); }
          catch (e) {
            if (handlerErrors === 'throw') throw e;
            if (typeof console !== 'undefined') console.error('[bus:' + name + ']', e.message || e);
          }
        });
      }
      wildcards.forEach(function (w) {
        if (name.length > w.suffix.length && name.slice(-w.suffix.length) === w.suffix) {
          try { w.fn(data, name); }
          catch (e) {
            if (handlerErrors === 'throw') throw e;
            if (typeof console !== 'undefined') console.error('[bus:*' + w.suffix + ']', e.message || e);
          }
        }
      });
    };

    /* scope(prefix) — a child bus with namespaced events */
    bus.scope = function (prefix) {
      var child = createBus(opts);
      child._parent = bus;
      child._prefix = prefix;
      /* relay the child's emits to the parent as prefix:event */
      var origEmit = child.emit;
      child.emit = function (name, data) {
        origEmit(name, data);
        bus.emit(prefix + ':' + name, data);
      };
      return child;
    };

    /* listenerCount(name?) — for tests + debug */
    bus.listenerCount = function (name) {
      if (name) return handlers[name] ? handlers[name].size : 0;
      var total = 0;
      Object.keys(handlers).forEach(function (n) { total += handlers[n].size; });
      return total + wildcards.length;
    };

    /* clear(name?) — remove all listeners (for teardown) */
    bus.clear = function (name) {
      if (name) delete handlers[name];
      else { handlers = {}; wildcards = []; }
    };

    return bus;
  }

  return { createBus: createBus };
});
