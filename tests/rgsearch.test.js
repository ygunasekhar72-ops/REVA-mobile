/* Unit test: ripgrep integration primitives (js/loopcore.js rgArgs/parseRg)
   — argv shape handed to the agent shell and output parsing back into
   bounded, path-rewritten hits. */
'use strict';
const assert = require('assert');
const LoopCore = require('../js/loopcore.js');

(async () => {
  // 1. argv shape: plain text uses --fixed-strings, glob passthrough
  const a1 = LoopCore.rgArgs('todo list', '/host/library/demo', { glob: '*.js' });
  assert.deepStrictEqual(a1, ['rg', '--line-number', '--no-heading', '--smart-case', '--max-filesize', '512K', '--glob', '*.js', '--fixed-strings', '-e', 'todo list', '/host/library/demo']);
  // 2. regex mode drops --fixed-strings
  const a2 = LoopCore.rgArgs('foo.*bar', '/host/library/demo', { isRegex: true });
  assert.ok(a2.indexOf('--fixed-strings') < 0, 'no fixed-strings in regex mode');
  assert.strictEqual(a2[a2.length - 3], '-e');

  // 3. parse: path:line:text triples, bounded, long lines truncated
  const sample = [
    'src/app.js:12: const x = 1;',
    'src/app.js:44: function todo() {}',
    'lib/parse.py:7:def todo():',
    '',
    'a-very-long-line'
  ].join('\n');
  const r = LoopCore.parseRg(sample, 2);
  assert.strictEqual(r.total, 3, 'total counts all matches');
  assert.strictEqual(r.hits.length, 2, 'hits bounded at maxResults');
  assert.deepStrictEqual(r.hits[0], { path: 'src/app.js', line: 12, text: ' const x = 1;' });

  // 4. empty / garbage input is safe
  assert.deepStrictEqual(LoopCore.parseRg('', 60).hits, []);
  assert.deepStrictEqual(LoopCore.parseRg('random text without structure', 60).hits, []);

  console.log('rgsearch: 4/4 scenarios PASS');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
