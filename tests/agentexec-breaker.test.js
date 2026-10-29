/* Unit test: shell channel circuit breaker (js/agentexec.js).
   Simulates the on-device wedge — a native shell that stops answering —
   and verifies REVA (1) counts consecutive timeouts, (2) stops burning the
   full timeout once wedged, (3) probes for recovery and (4) self-heals
   without a restart. Runs in plain node; no browser, no native code. */
'use strict';
const assert = require('assert');

global.window = global; // the IIFE attaches AgentExec to window
let respond = false;    // does the fake native shell answer?
let buf = '';
global.window.REVAAgent = {
  start() {},
  interrupt() {},
  writeRaw(s) {
    buf += s;
    const m = buf.match(/__REVA_DONE__\$\?__([\w.-]+)\s*$/);
    if (m) {
      const id = m[1];
      buf = '';
      if (respond) {
        setImmediate(() => window.__revaAgentOut('$ echo hi\nhi\n__REVA_DONE__0__' + id + '\n'));
      } // else: silence — the caller's timeout fires, like the on-device wedge
    }
  }
};
require('../js/agentexec.js');
const AgentExec = window.AgentExec;

(async () => {
  // A. healthy channel: real output + real exit code
  respond = true;
  let r = await AgentExec.exec('echo hi', { timeoutMs: 5000 });
  assert.strictEqual(r.exit, 0, 'healthy exec should report exit 0');
  assert.ok(/hi/.test(r.out), 'healthy exec should capture output');
  assert.strictEqual(AgentExec.consecTimeouts, 0, 'counter stays 0 when healthy');

  // B. wedge onset: three consecutive timeouts, counter climbs
  respond = false;
  for (let i = 1; i <= AgentExec.WEDGE_LIMIT; i++) {
    r = await AgentExec.exec('sleep 999', { timeoutMs: 5000 });
    assert.strictEqual(r.timedOut, true, 'timeout ' + i + ' should be reported');
    assert.strictEqual(AgentExec.consecTimeouts, i, 'counter should climb with each timeout');
  }

  // C. breaker: the next call must NOT burn another full timeout — it probes
  //    (8s budget) and returns an honest wedged result with guidance
  const t0 = Date.now();
  r = await AgentExec.exec('echo again', { timeoutMs: 5000 });
  const dt = Date.now() - t0;
  assert.strictEqual(r.wedged, true, 'wedged flag should be set');
  assert.ok(/unresponsive/.test(r.out), 'wedged result should explain itself');
  assert.ok(dt < 12000, 'wedged call should cost ~probe time (8s), got ' + dt + 'ms');

  // D. self-heal: the shell starts answering again — next call recovers
  //    through the probe path, no restart, counter reset
  respond = true;
  r = await AgentExec.exec('echo back', { timeoutMs: 5000 });
  assert.strictEqual(r.exit, 0, 'recovered exec should succeed');
  assert.strictEqual(AgentExec.consecTimeouts, 0, 'counter should reset after recovery');

  console.log('agentexec-breaker: 4/4 scenarios PASS');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
