/* Unit test: the Test Factory (js/testfactory.js).
   Export detection, method extraction, planning, and scaffold rendering.
   The EXECUTION proof (the rendered scaffold actually running green under
   node) lives in the release checklist step — this file stays free of
   child_process by design (scanner policy: no process spawning in tests). */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const T = require('../js/testfactory.js');

(async () => {
  // 1. detectExports: the four evidence classes
  assert.deepStrictEqual(
    T.detectExports('module.exports = { createApp, VERSION: 3, registerPlugin: function () {} };'),
    ['createApp', 'VERSION', 'registerPlugin'], 'UMD map: keys + shorthand');
  assert.deepStrictEqual(T.detectExports('module.exports = SCHEDULER;'), ['SCHEDULER'], 'single export');
  assert.deepStrictEqual(T.detectExports('exports.a = 1; exports.b = 2;'), ['a', 'b'], 'exports.x (same line too)');
  assert.deepStrictEqual(T.detectExports('function hello(){} class Box {}'), ['hello', 'Box'], 'fallback decls (same line too)');

  // 2. detectMethods: class body, constructor skipped
  const cls = 'class Stack {\n  constructor() { this.n = 0; }\n  push(v) { return v; }\n  async pop() {}\n  get size() { return this.n; }\n}';
  assert.deepStrictEqual(T.detectMethods(cls, 'Stack'), ['push', 'pop'], 'methods found, constructor/get skipped');

  // 3. protoMethods: the constructor-function pattern REVA UMD files use
  const protoSrc = 'function W(){}\nW.prototype.reset = function(){};\nW.prototype.render = function(){};';
  assert.deepStrictEqual(T.protoMethods(protoSrc), { W: ['reset', 'render'] }, 'prototype map');

  // 4. planTests over fixtures
  const SM = fs.readFileSync(path.join(__dirname, '..', 'js', 'statemachine.js'), 'utf8');
  assert.deepStrictEqual(T.planTests(SM), [{ name: 'api', kind: 'single' }], 'single export wins early');
  const protoFix = 'module.exports = Widget;\nfunction Widget(){}\nWidget.prototype.reset = function(){};\nWidget.prototype.render = function(){};';
  assert.deepStrictEqual(T.planTests(protoFix),
    [{ name: 'Widget', kind: 'proto', methods: ['reset', 'render'] }], 'proto plan carries methods');
  const mapFix = 'module.exports = { open, close: null, size: 1 };';
  assert.deepStrictEqual(T.planTests(mapFix).map(p => p.kind + ':' + p.name),
    ['object:open', 'object:close', 'object:size'], 'UMD map plan');
  const classFix = 'module.exports = Queue;\nclass Queue {\n  enqueue(x) {}\n  drain() {}\n}';
  assert.deepStrictEqual(T.planTests(classFix),
    [{ name: 'Queue', kind: 'class', methods: ['enqueue', 'drain'] }], 'class plan carries methods');

  // 5. renderSuite structure for a REAL module (i18n) + staging the self-proof
  const i18nSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'i18n.js'), 'utf8');
  const suite = T.renderSuite(T.planTests(i18nSrc), { relPath: 'js/i18n.js' });
  assert.ok(/const M = require\('\.\.\/js\/i18n\.js'\);/.test(suite), 'require path derived from relPath');
  assert.ok(/assert\.ok\(M, 'module exports api'\)/.test(suite) && /scaffold PASS \(1 contract checks\)/.test(suite),
    'single-export contract lines present');

  /* staging: fixture + rendered scaffold for the release-checklist execution
     proof (scratch-tf/ is untracked; the checklist runs node on it) */
  const stage = path.join(__dirname, '..', 'scratch-tf');
  try { fs.mkdirSync(stage); } catch (_) {}
  try { fs.mkdirSync(path.join(stage, 'nested')); } catch (_) {}
  fs.writeFileSync(path.join(stage, 'mod.js'),
    'module.exports = Widget;\nfunction Widget(){}\nWidget.prototype.reset = function(){};\nWidget.prototype.render = function(){};\n');
  const scaffold = T.renderSuite(T.planTests(
    'module.exports = Widget;\nfunction Widget(){}\nWidget.prototype.reset = function(){};\nWidget.prototype.render = function(){};'),
    { relPath: 'mod.js' });
  fs.writeFileSync(path.join(stage, 'nested', 'scaffold.test.js'), scaffold);
  assert.ok(/require\('\.\.\/mod\.js'\)/.test(scaffold), 'staged scaffold points at the fixture');

  console.log('testfactory: 5/5 scenario groups PASS (detection + planning + rendering + staged self-proof)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
