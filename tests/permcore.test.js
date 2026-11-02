/* Unit test: the Permission Core (js/permcore.js) — tool classes, ordered
   rules with glob/exact arg matching, defaults fallback, audit ring,
   serialization. Launch default: inert (everything allowed, zero rules). */
'use strict';
const assert = require('assert');
const PC = require('../js/permcore.js');

(async () => {
  // 1. classification: the four classes + fail-closed unknown
  assert.strictEqual(PC.classify('read_file'), 'read', 'read class');
  assert.strictEqual(PC.classify('write_file'), 'write', 'write class');
  assert.strictEqual(PC.classify('shell_exec'), 'exec', 'exec class');
  assert.strictEqual(PC.classify('http_request'), 'external', 'external class');
  assert.strictEqual(PC.classify('brand_new_tool'), 'exec', 'unknown fails closed to exec');

  // 2. inert by default: everything allowed, audit records it
  const p0 = PC.createPolicy({});
  assert.strictEqual(p0.decide('read_file').decision, 'allow', 'default read allow');
  assert.strictEqual(p0.decide('shell_exec', { command: 'rm -rf /' }).decision, 'allow', 'default exec allow (inert launch default)');
  assert.strictEqual(p0.decide('shell_exec', { command: 'rm -rf /' }).via, 'default:exec', 'via names the default');

  // 3. defaults override: a hardened profile in one line
  const hardened = PC.createPolicy({ defaults: { write: 'ask', exec: 'deny' } });
  assert.strictEqual(hardened.decide('write_file').decision, 'ask', 'hardened write asks');
  assert.strictEqual(hardened.decide('shell_exec').decision, 'deny', 'hardened exec denies');
  assert.strictEqual(hardened.decide('read_file').decision, 'allow', 'read still allows');

  // 4. tool-level rules: deny beats the default, first match wins
  const p1 = PC.createPolicy({});
  p1.addRule({ tool: 'shell_exec', decision: 'ask' });
  assert.strictEqual(p1.decide('shell_exec').decision, 'ask', 'tool rule beats default');
  assert.strictEqual(p1.decide('shell_exec').via, 'rule:' + p1.listRules()[0].id, 'via names the rule');
  p1.addRule({ tool: 'shell_exec', decision: 'deny' });
  assert.strictEqual(p1.decide('shell_exec').decision, 'deny', 'newest rule first (first match wins)');

  // 5. argument rules: exact + glob patterns
  const p2 = PC.createPolicy({});
  p2.addRule({ tool: 'shell_exec', decision: 'allow', arg: 'command', pattern: 'npm *' });
  p2.addRule({ tool: 'shell_exec', decision: 'deny', arg: 'command', pattern: 'rm -rf*' });
  p2.addRule({ tool: 'shell_exec', decision: 'allow', arg: 'command', exact: 'node tests/all.js' });
  assert.strictEqual(p2.decide('shell_exec', { command: 'npm test' }).decision, 'allow', 'glob allow');
  assert.strictEqual(p2.decide('shell_exec', { command: 'npm run build' }).decision, 'allow', 'glob prefix');
  assert.strictEqual(p2.decide('shell_exec', { command: 'rm -rf /' }).decision, 'deny', 'glob deny');
  assert.strictEqual(p2.decide('shell_exec', { command: 'node tests/all.js' }).decision, 'allow', 'exact allow');
  assert.strictEqual(p2.decide('shell_exec', { command: 'curl evil.example' }).decision, 'allow', 'unmatched falls to default');

  // 6. case-insensitive matching + non-string args coerced
  assert.strictEqual(p2.decide('shell_exec', { command: 'NPM TEST' }).decision, 'allow', 'case-insensitive glob');
  assert.strictEqual(p2.decide('shell_exec', { command: 42 }).decision, 'allow', 'numeric arg coerced (no crash)');

  // 7. missing arg: rule with arg constraint does not fire
  assert.strictEqual(p2.decide('shell_exec').decision, 'allow', 'no args = arg-rule skipped');

  // 8. scoped allow rules on a hardened default: deny must stop the tool
  const p3 = PC.createPolicy({ defaults: { write: 'deny', exec: 'deny' } });
  p3.addRule({ tool: 'write_file', decision: 'allow', arg: 'path', pattern: 'workspace/*' });
  assert.strictEqual(p3.decide('write_file', { path: 'workspace/a.js' }).decision, 'allow', 'scoped write allowed');
  assert.strictEqual(p3.decide('write_file', { path: 'lib/other/x.js' }).decision, 'deny', 'write outside scope denied');
  for (let i = 0; i < 250; i++) p3.decide('read_file');
  assert.ok(p3.auditLog().length <= 200, 'audit capped at 200');
  assert.strictEqual(p3.auditLog()[0].tool, 'read_file', 'audit newest first');

  // 9. validation + serialization round-trip
  assert.strictEqual(p3.addRule({ tool: '', decision: 'deny' }), null, 'tool required');
  assert.strictEqual(p3.addRule({ tool: 'x', decision: 'maybe' }), null, 'decision validated');
  const snap = p3.toJSON();
  const p4 = PC.createPolicy({});
  p4.fromJSON(snap);
  assert.deepStrictEqual(p4.listRules(), p3.listRules(), 'rules round-trip');
  assert.strictEqual(p4.decide('shell_exec').decision, 'deny', 'defaults round-trip');
  p4.fromJSON({ v: 9 }); /* bad version ignored */
  assert.strictEqual(p4.decide('shell_exec').decision, 'deny', 'bad snapshot rejected');

  console.log('permcore: 9/9 scenario groups PASS (classes + rules + audit + serialization)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
