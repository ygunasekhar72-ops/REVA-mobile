/* Unit test: the State Machine Engine (js/statemachine.js) — subsystem #8.
   States, transitions, guards, actions, context, serialization, nesting. */
'use strict';
const assert = require('assert');
const SM = require('../js/statemachine.js');

(async () => {
  // 1. basic transitions
  var fsm = SM.createStateMachine({
    initial: 'menu',
    states: {
      menu: { on: { start: 'playing', help: 'help' } },
      playing: { on: { pause: 'paused', gameover: 'gameover' } },
      paused: { on: { resume: 'playing', quit: 'menu' } },
      gameover: { on: { restart: 'playing', menu: 'menu' } },
      help: { on: { back: 'menu' } }
    }
  });
  assert.strictEqual(fsm.state, 'menu', 'initial state');
  assert.ok(fsm.send('start'), 'start transition');
  assert.strictEqual(fsm.state, 'playing', 'now playing');
  assert.ok(fsm.send('pause'), 'pause');
  assert.strictEqual(fsm.state, 'paused', 'now paused');
  assert.ok(fsm.send('resume'), 'resume');
  assert.strictEqual(fsm.state, 'playing', 'back to playing');

  // 2. invalid events return false (the state doesn't change)
  assert.ok(!fsm.send('start'), 'start is invalid from playing');
  assert.strictEqual(fsm.state, 'playing', 'state unchanged after invalid event');
  assert.ok(fsm.send('pause'), 'pause is valid from playing');
  assert.strictEqual(fsm.state, 'paused', 'now paused');

  // 3. can(): check without executing
  assert.ok(fsm.can('resume'), 'can resume from paused');
  assert.ok(!fsm.can('start'), 'cannot start from paused');

  // 4. guards: conditional transitions
  var guardFsm = SM.createStateMachine({
    initial: 'menu',
    context: { hasSave: false },
    states: {
      menu: {
        on: {
          continue: { target: 'game', guard: function (ctx) { return ctx.hasSave; } },
          new: 'game'
        }
      },
      game: { on: { quit: 'menu' } }
    }
  });
  assert.ok(!guardFsm.send('continue'), 'guard blocks (no save)');
  assert.strictEqual(guardFsm.state, 'menu', 'stayed on menu');
  guardFsm.setContext('hasSave', true);
  assert.ok(guardFsm.send('continue'), 'guard passes (has save)');
  assert.strictEqual(guardFsm.state, 'game', 'now in game');

  // 5. actions: side effects during transition
  var actionLog = [];
  var actionFsm = SM.createStateMachine({
    initial: 'idle',
    context: { score: 0 },
    states: {
      idle: { on: { start: { target: 'running', action: function (ctx) { ctx.score = 100; actionLog.push('started'); } } } },
      running: { on: { stop: 'idle' } }
    }
  });
  actionFsm.send('start');
  assert.strictEqual(actionFsm.getContext('score'), 100, 'action set the score');
  assert.deepStrictEqual(actionLog, ['started'], 'action logged');

  // 6. entry/exit hooks
  var entryExit = [];
  var hookFsm = SM.createStateMachine({
    initial: 'off',
    states: {
      off: { on: { toggle: 'on' }, exit: function () { entryExit.push('exit-off'); } },
      on: {
        on: { toggle: 'off' },
        entry: function () { entryExit.push('entry-on'); },
        exit: function () { entryExit.push('exit-on'); }
      }
    }
  });
  hookFsm.send('toggle');
  assert.deepStrictEqual(entryExit, ['exit-off', 'entry-on'], 'exit before entry');
  hookFsm.send('toggle');
  assert.deepStrictEqual(entryExit, ['exit-off', 'entry-on', 'exit-on'], 'exit fired on close');

  // 7. serialization: toJSON / fromJSON
  var saveFsm = SM.createStateMachine({
    initial: 'menu',
    context: { level: 3, score: 500 },
    states: {
      menu: { on: { play: 'playing' } },
      playing: { on: { quit: 'menu' } }
    }
  });
  saveFsm.send('play');
  saveFsm.setContext('level', 5);
  var snapshot = saveFsm.toJSON();
  assert.strictEqual(snapshot.state, 'playing', 'snapshot state');
  assert.strictEqual(snapshot.context.level, 5, 'snapshot context');
  /* restore into a fresh machine */
  var restored = SM.createStateMachine({
    initial: 'menu',
    states: { menu: { on: { play: 'playing' } }, playing: { on: { quit: 'menu' } } }
  });
  restored.fromJSON(snapshot);
  assert.strictEqual(restored.state, 'playing', 'restored state');

  // 8. re-entrancy guard: a transition action that sends another event
  var reentFsm = SM.createStateMachine({
    initial: 'a',
    states: {
      a: { on: { go: { target: 'b', action: function () { reentFsm.send('go'); } } } },
      b: { on: { back: 'a' } }
    }
  });
  var reentResult = reentFsm.send('go');
  assert.ok(reentResult !== undefined, 're-entrant send handled (no crash)');

  // 9. nested machine: hierarchical states
  var nested = SM.createNestedMachine({
    initial: 'menu',
    states: { menu: { on: { play: 'inGame' } }, inGame: { on: { quit: 'menu' } } }
  });
  nested.addChild('inGame', {
    initial: 'exploring',
    states: { exploring: { on: { fight: 'fighting' } }, fighting: { on: { win: 'exploring' } } }
  });
  nested.send('play');
  assert.strictEqual(nested.state, 'inGame', 'in game state');
  var child = nested.getChild('inGame');
  assert.ok(child, 'child machine exists');
  assert.strictEqual(child.state, 'exploring', 'child initial state');
  nested.send('fight'); // forwarded to the child (unhandled by the parent)
  assert.strictEqual(child.state, 'fighting', 'event forwarded to the child');

  // 10. reset: back to initial
  fsm.reset();
  assert.strictEqual(fsm.state, 'menu', 'reset to initial');

  console.log('statemachine: 10/10 scenarios PASS (transitions + guards + actions + hooks + serialization + nesting)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
