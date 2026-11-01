/* REVA — State Machine Engine (original subsystems engine, subsystem #8).
   A formal finite state machine for game and app state management:
   - states with entry/exit actions
   - transitions with guards (conditional) and actions (side effects)
   - hierarchical states (nested machines)
   - event-driven: machine.send(event) → transition → side effects
   - history: remember the last nested state for re-entry
   - serialized: toJSON/fromJSON for save systems
   Pure UMD: identical code in node tests and the WebView. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.STATEMACHINE = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  /* createStateMachine(config)
     config: {
       initial: 'menu',
       states: {
         menu: {
           on: { start: 'playing', help: 'help' },
           entry: function (machine) { … },
           exit: function (machine) { … }
         },
         playing: {
           on: { pause: 'paused', gameover: 'gameover' },
           entry: …, exit: …
         },
         paused: {
           on: { resume: 'playing', quit: 'menu' }
         },
         gameover: {
           on: { restart: 'playing', menu: 'menu' }
         }
       }
     } */
  function createStateMachine(config) {
    var state = config.initial;
    var context = Object.assign({}, config.context || {});
    var history = {}; // for hierarchical state re-entry
    var lock = false;  // prevent re-entrant transitions

    var machine = {
      get state() { return state; },
      get context() { return context; },
      get isLocked() { return lock; },

      /* can(event): check if a transition exists (without executing) */
      can: function (event) {
        var st = config.states[state];
        return !!(st && st.on && st.on[event] !== undefined);
      },

      /* send(event, payload): fire a transition */
      send: function (event, payload) {
        if (lock) return false; // re-entrancy guard
        var st = config.states[state];
        if (!st || !st.on || st.on[event] === undefined) return false;

        var target = st.on[event];
        var guard = null, action = null;

        /* the transition can be a string (state name) or an object {target, guard, action} */
        if (typeof target === 'object') {
          if (target.guard) {
            guard = target.guard;
            var allowed = guard(context, payload);
            if (!allowed) return false;
          }
          action = target.action || null;
          target = target.target;
        }

        if (!config.states[target]) return false;

        lock = true;
        /* exit the current state */
        if (st.exit) st.exit(context, payload);
        /* the transition action (side effects between exit and entry) */
        if (action) action(context, payload);
        /* enter the new state */
        state = target;
        var newSt = config.states[target];
        if (newSt.entry) newSt.entry(context, payload);
        lock = false;
        return true;
      },

      /* setContext(key, value): update the shared context */
      setContext: function (key, value) { context[key] = value; },
      getContext: function (key) { return context[key]; },

      /* reset: go back to the initial state with fresh context */
      reset: function () {
        state = config.initial;
        context = Object.assign({}, config.context || {});
      },

      /* toJSON / fromJSON: for save systems */
      toJSON: function () {
        return { state: state, context: JSON.parse(JSON.stringify(context)) };
      },
      fromJSON: function (snapshot) {
        if (snapshot && snapshot.state && config.states[snapshot.state]) {
          state = snapshot.state;
          context = Object.assign({}, snapshot.context || {});
        }
      }
    };

    return machine;
  }

  /* createNestedMachine: hierarchical states — a state can contain its own machine */
  function createNestedMachine(config) {
    var machine = createStateMachine(config);
    var children = {}; // state name → child machine

    machine.addChild = function (stateName, childConfig) {
      children[stateName] = createStateMachine(childConfig);
      return children[stateName];
    };

    /* override send to also forward events to the active child machine */
    var origSend = machine.send;
    machine.send = function (event, payload) {
      var handled = origSend(event, payload);
      /* forward unhandled events to the child machine of the current state */
      if (!handled && children[machine.state]) {
        return children[machine.state].send(event, payload);
      }
      return handled;
    };

    /* expose the child machine for the current state */
    machine.getChild = function (stateName) { return children[stateName] || null; };

    return machine;
  }

  return {
    createStateMachine: createStateMachine,
    createNestedMachine: createNestedMachine
  };
});
