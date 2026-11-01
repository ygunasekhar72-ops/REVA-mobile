/* Unit test: the REVA Diff Engine (js/diffeng.js) — our own Myers diff.
   Edit-script correctness, unified generation, patch parse/apply with fuzz,
   three-way merge (clean + conflict + collapse), similarity, alignment. */
'use strict';
const assert = require('assert');
const D = require('../js/diffeng.js');

(async () => {
  // 1. myers edit script: the classic cases
  const ops = (a, b) => D.myersScript(a.split('\n'), b.split('\n')).map(s => s.op).join('');
  assert.strictEqual(ops('a', 'a'), '=', 'identical');
  assert.ok(/^-|=/.test(ops('a\nb\nc', 'a\nx\nc')) && ops('a\nb\nc', 'a\nx\nc').indexOf('-') >= 0 && ops('a\nb\nc', 'a\nx\nc').indexOf('+') >= 0, 'replace = del+add (either alignment)');
  const appendOps = ops('a\nb\nc', 'a\nb\nc\nd');
  assert.ok(appendOps.split('=').length - 1 === 3 && appendOps.split('+').length - 1 === 1 && appendOps.indexOf('-') < 0, 'append (3 eq + 1 add)');
  const delOps = ops('a\nb\nc', 'a\nc');
  assert.ok(delOps.split('=').length - 1 === 2 && delOps.split('-').length - 1 === 1 && delOps.indexOf('+') < 0, 'delete middle (2 eq + 1 del)');
  const pureAdd = ops('', 'x\ny');
  assert.ok(pureAdd.split('+').length - 1 === 2 && pureAdd.split('-').length - 1 <= 1, 'pure add (2 adds, at most the empty-line deletion)');
  const pureDel = ops('x\ny', '');
  assert.ok(pureDel.split('-').length - 1 === 2 && pureDel.split('+').length - 1 <= 1, 'pure delete (2 dels, at most the empty-line addition)');
  /* the script replays: applying it reconstructs b exactly */
  function replay(aText, bText) {
    var a = aText.split('\n'), b = bText.split('\n');
    var out = [];
    D.myersScript(a, b).forEach(s => { if (s.op === '=') out.push(a[s.a]); else if (s.op === '+') out.push(b[s.b]); });
    return out.join('\n');
  }
  assert.strictEqual(replay('a\nb\nc\nd', 'a\nX\nc\nd'), 'a\nX\nc\nd', 'replay reconstructs b');

  // 2. unified generation: header, hunk header, prefix chars
  const u = D.unifiedDiff('one\ntwo\nthree', 'one\nTWO\nthree', 'old.js', 'new.js');
  assert.ok(u.indexOf('--- old.js') === 0 && u.indexOf('+++ new.js') > 0, 'file headers');
  assert.ok(u.indexOf('@@ -1,3 +1,3 @@') > 0, 'hunk header with counts');
  assert.ok(u.indexOf('-two') > 0 && u.indexOf('+TWO') > 0 && u.indexOf(' one') > 0, 'prefix chars');
  assert.strictEqual(D.unifiedDiff('same', 'same', 'a', 'b'), '', 'no changes → empty patch');

  // 3. patch parse: hunks, counts, context/removal/addition lines
  const hunks = D.parsePatch(u);
  assert.strictEqual(hunks.length, 1);
  assert.strictEqual(hunks[0].aStart, 1);
  assert.deepStrictEqual(hunks[0].lines.map(l => l.op + l.t), ['=one', '-two', '+TWO', '=three']);

  // 4. apply: roundtrip, insert, delete, new-file, empty-file, multi-hunk
  const rt = D.applyPatch('one\ntwo\nthree', u);
  assert.ok(rt.ok && rt.result === 'one\nTWO\nthree', 'roundtrip');
  const ins = D.applyPatch('a\nb', D.unifiedDiff('a\nb', 'a\nnew\nb', 'a', 'b'));
  assert.ok(ins.ok && ins.result === 'a\nnew\nb', 'insertion');
  const del = D.applyPatch('a\nb\nc', D.unifiedDiff('a\nb\nc', 'a\nc', 'a', 'b'));
  assert.ok(del.ok && del.result === 'a\nc', 'deletion');
  const nf = D.applyPatch('', D.unifiedDiff('', 'x\ny', 'a', 'b'));
  assert.ok(nf.ok && nf.result === 'x\ny', 'new file');
  const ef = D.applyPatch('only', D.unifiedDiff('only', '', 'a', 'b'));
  assert.ok(ef.ok && ef.result === '', 'to-empty file');
  const multiSrc = 'a\nb\nc\nd\ne\nf\ng', multiDst = 'a\nb\nX\nd\ne\nY\ng';
  const mh = D.applyPatch(multiSrc, D.unifiedDiff(multiSrc, multiDst, 'a', 'b', 1));
  assert.ok(mh.ok && mh.result === multiDst, 'multi-hunk with context 1');

  // 5. fuzz: drifted content still applies; honesty when impossible
  const drift = D.applyPatch('intro\none\ntwo\nthree\noutro', u, { fuzz: 3 });
  assert.ok(drift.ok && drift.result === 'intro\none\nTWO\nthree\noutro', 'fuzz applies drifted');
  const bad = D.applyPatch('totally\ndifferent', u);
  assert.ok(!bad.ok && /hunk #1/.test(bad.error) && bad.hunk === 0, 'mismatch honest with hunk index');

  // 6. three-way merge: clean, conflict, collapse
  const clean = D.threeWayMerge('a\nb\nc', 'a\nB\nc', 'a\nb\nC');
  assert.ok(clean.clean && clean.merged === 'a\nB\nC', 'non-overlapping auto-merge');
  const collapse = D.threeWayMerge('a\nb\nc', 'a\nSAME\nc', 'a\nSAME\nc');
  assert.ok(collapse.clean && collapse.merged === 'a\nSAME\nc', 'identical changes collapse');
  const conflict = D.threeWayMerge('a\nb\nc', 'a\nOURS\nc', 'a\nTHEIRS\nc');
  assert.ok(!conflict.clean, 'overlap conflicts');
  assert.ok(conflict.merged.indexOf('<<<<<<< ours') >= 0 && conflict.merged.indexOf('=======') >= 0 && conflict.merged.indexOf('>>>>>>> theirs') >= 0, 'git-style markers');
  assert.strictEqual(conflict.conflicts.length, 1, 'one structured conflict');
  assert.strictEqual(conflict.conflicts[0].ours, 'OURS', 'conflict carries ours');
  assert.strictEqual(conflict.conflicts[0].theirs, 'THEIRS', 'conflict carries theirs');
  /* edits in different regions merge without touching each other */
  const far = D.threeWayMerge('one\ntwo\nthree\nfour\nfive', 'ONE\ntwo\nthree\nfour\nfive', 'one\ntwo\nthree\nfour\nFIVE');
  assert.ok(far.clean && far.merged === 'ONE\ntwo\nthree\nfour\nFIVE', 'far-apart edits both land');
  /* one side deletes, the other edits elsewhere */
  const delOther = D.threeWayMerge('a\nb\nc', 'a\nc', 'a\nb\nC');
  assert.ok(delOther.clean && delOther.merged === 'a\nC', 'delete + far edit compose');

  // 7. similarity: identity bounds + rename-detection behavior
  assert.strictEqual(D.similarity('a\nb', 'a\nb'), 1, 'identical → 1');
  assert.ok(D.similarity('a\nb\nc', 'x\ny\nz') < 0.2, 'disjoint → low');
  assert.ok(D.similarity('a\nb\nc\nd\ne', 'a\nb\nc\nd\nf') > 0.6, 'near-copy → rename-grade');

  // 8. side-by-side alignment: paired rows, del/add blocks
  const rows = D.alignSides('a\nb\nc', 'a\nB\nc');
  assert.strictEqual(rows.length, 3, 'aligned row count');
  assert.ok(rows[1].left.op === '-' && rows[1].right.op === '+', 'change row paired');
  const block = D.alignSides('a\nb\nc\nd', 'a\nX\nY\nc\nd');
  const changedRows = block.filter(r => r.left && r.left.op === '-' || r.right && r.right.op === '+');
  assert.ok(changedRows.length >= 2, 'multi-line change block aligned');

  // 9. word + char diffs
  const wd = D.wordDiff('the quick fox', 'the slow fox');
  assert.ok(wd.some(w => w.op === '-' && /quick/.test(w.text)) && wd.some(w => w.op === '+' && /slow/.test(w.text)), 'word diff');
  const cd = D.charDiff('abc', 'abd');
  assert.ok(cd.some(c => c.op === '-' && c.ch === 'c') && cd.some(c => c.op === '+' && c.ch === 'd'), 'char diff');

  console.log('diffeng: 9/9 scenarios PASS (Myers + patches + merge + align)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
