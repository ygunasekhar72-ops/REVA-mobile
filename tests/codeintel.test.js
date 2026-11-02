/* Unit test: Code Intelligence (js/codeintel.js) — symbol index, cross-file
   definitions/references, jump-target resolution. */
'use strict';
const assert = require('assert');
const CI = require('../js/codeintel.js');

(async () => {
  const files = {
    'app.js': [
      'function renderModels() {',
      '  helper();',
      '}',
      'function helper() {',
      '  renderModels();',
      '}'
    ].join('\n'),
    'ui.js': [
      'const helper = () => 1;',
      'class Widget {',
      '  mount() {}',
      '  async unmount() {}',
      '}'
    ].join('\n'),
    'notes.md': 'helper is mentioned here but markdown is not indexed'
  };

  const ix = CI.buildIndex(files);

  // 1. definitions: function, const-fn, class, method
  assert.ok(CI.definitions(ix, 'renderModels').some(r => r.path === 'app.js' && r.line === 1), 'function def');
  assert.ok(CI.definitions(ix, 'helper').some(r => r.path === 'ui.js' && r.line === 1), 'const-fn def');
  assert.ok(CI.definitions(ix, 'Widget').some(r => r.path === 'ui.js' && r.line === 2), 'class def');
  assert.ok(CI.definitions(ix, 'mount').some(r => r.path === 'ui.js' && r.line === 3), 'method def');
  assert.ok(CI.definitions(ix, 'unmount').some(r => r.line === 4), 'async method def');

  // 2. cross-file references (markdown excluded from the index entirely)
  const helperRefs = CI.references(ix, 'helper');
  assert.strictEqual(helperRefs.length, 1, 'one cross-file ref');
  assert.strictEqual(helperRefs[0].path, 'app.js', 'ref in the consumer file');
  assert.strictEqual(helperRefs[0].line, 2, 'ref line exact');
  assert.strictEqual(CI.references(ix, 'Widget').length, 0, 'class with no usages = no refs');

  // 3. mutual references do not collide (def rows stay defs)
  assert.ok(CI.definitions(ix, 'renderModels').length === 1, 'def stays def despite the mutual ref');
  assert.ok(CI.references(ix, 'renderModels').some(r => r.line === 5), 'mutual usage is a ref');

  // 4. jump target: same file wins; else first def; missing = null
  assert.deepStrictEqual(CI.jumpTarget(ix, 'helper', 'app.js'), { path: 'app.js', line: 4, kind: 'def' }, 'same-file def wins');
  assert.deepStrictEqual(CI.jumpTarget(ix, 'helper', 'ui.js'), { path: 'ui.js', line: 1, kind: 'def' }, 'from the other file');
  assert.deepStrictEqual(CI.jumpTarget(ix, 'renderModels', 'ui.js'), { path: 'app.js', line: 1, kind: 'def' }, 'cross-file jump');
  assert.strictEqual(CI.jumpTarget(ix, 'nope', 'app.js'), null, 'unknown symbol = null');

  // 5. the ref scan skips member accesses as DEFINITIONS but keeps them as refs
  const files2 = { 'x.js': 'obj.method();\nobj.deep.child();\nvar f2 = function () {};' };
  const ix2 = CI.buildIndex(files2);
  assert.strictEqual(CI.definitions(ix2, 'f2').length, 1, 'var-fn def');
  assert.ok(CI.references(ix2, 'method').some(r => r.line === 1), 'member call is a ref of its name');
  assert.strictEqual(CI.definitions(ix2, 'method').length, 0, 'member call is never a definition');

  // 6. python + shell get indexed too
  const files3 = { 'svc.py': 'def serve():\n    serve()', 'run.sh': 'serve' };
  const ix3 = CI.buildIndex(files3);
  assert.ok(CI.definitions(ix3, 'serve').length === 1, 'python def');
  assert.ok(CI.references(ix3, 'serve').length >= 1, 'usages across py + sh');

  // 7. real-file smoke: the harness's own idecore indexes cleanly
  const fs = require('fs');
  const path = require('path');
  const realSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'codeintel.js'), 'utf8');
  const ix4 = CI.buildIndex({ 'codeintel.js': realSrc });
  assert.ok(CI.definitions(ix4, 'buildIndex').length === 1, 'self-index finds buildIndex');
  assert.ok(CI.references(ix4, 'buildIndex').length >= 1, 'self-index finds its own callers');

  console.log('codeintel: 7/7 scenario groups PASS (index + cross-file refs + jump targets)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
