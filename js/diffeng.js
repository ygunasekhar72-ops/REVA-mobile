/* REVA — Diff Engine (original subsystems engine, subsystem #1).
   Our own Myers-diff implementation — not a wrapper: the algorithms REVA
   owns for the IDE, checkpoint comparisons, and the agent's patch tool.
   - lineDiff: Myers O(ND) with prefix/suffix trimming → edit script
   - unifiedDiff / parsePatch / applyPatch: the patch(1) contract, with fuzz
   - threeWayMerge: non-overlapping changes auto-merge, overlaps conflict
   - wordDiff / charDiff, similarity (rename detection), alignSides
   Pure UMD: identical code in node tests and the WebView. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DIFFENG = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  /* ---- Myers O(ND) diff over line arrays ----
     Returns an edit script: [{op:'='|'-'|'+', a: aIndex|-1, b: bIndex|-1}]. */
  function myersScript(aLines, bLines) {
    var N = aLines.length, M = bLines.length;
    var script = [];
    var ai = 0, bi = 0;
    /* trim the common prefix/suffix first — typical files barely differ */
    while (ai < N && bi < M && aLines[ai] === bLines[bi]) { script.push({ op: '=', a: ai, b: bi }); ai++; bi++; }
    var sfx = [];
    while (N - 1 >= ai && M - 1 >= bi && aLines[N - 1] === bLines[M - 1]) { sfx.push({ op: '=', a: N - 1, b: M - 1 }); N--; M--; }
    var aCore = aLines.slice(ai, N), bCore = bLines.slice(bi, M);
    var n = aCore.length, m = bCore.length;
    if (n || m) {
      var max = n + m;
      var v = { 1: 0 }, trace = [];
      var found = -1;
      for (var d = 0; d <= max && found < 0; d++) {
        trace.push({});
        for (var k = -d; k <= d; k += 2) {
          var x;
          if (k === -d || (k !== d && v[k - 1] < v[k + 1])) x = v[k + 1];
          else x = v[k - 1] + 1;
          var y = x - k;
          while (x < n && y < m && aCore[x] === bCore[y]) { x++; y++; }
          v[k] = x;
          trace[d][k] = x;
          if (x >= n && y >= m) { found = d; break; }
        }
      }
      /* backtrack the trace into the edit script (reverse walk) */
      var ops = [];
      var px = n, py = m;
      for (var dd = found; dd > 0; dd--) {
        var vk = trace[dd];
        var kk = px - py;
        var prevK = (kk === -dd || (kk !== dd && (trace[dd - 1][kk - 1] || 0) < (trace[dd - 1][kk + 1] || 0))) ? kk + 1 : kk - 1;
        var prevX = trace[dd - 1] ? (trace[dd - 1][prevK] || 0) : 0;
        var prevY = prevX - prevK;
        while (px > prevX && py > prevY) { ops.push({ op: '=', a: ai + px - 1, b: bi + py - 1 }); px--; py--; }
        if (px === prevX) { ops.push({ op: '+', a: -1, b: bi + prevY }); py--; }
        else { ops.push({ op: '-', a: ai + prevX, b: -1 }); px--; }
      }
      while (px > 0 && py > 0 && aCore[px - 1] === bCore[py - 1]) { ops.push({ op: '=', a: ai + px - 1, b: bi + py - 1 }); px--; py--; }
      while (px > 0) { ops.push({ op: '-', a: ai + px - 1, b: -1 }); px--; }
      while (py > 0) { ops.push({ op: '+', a: -1, b: bi + py - 1 }); py--; }
      ops.reverse();
      script = script.concat(ops, sfx.reverse());
    } else {
      script = script.concat(sfx.reverse());
    }
    return script;
  }

  /* ---- unified diff generation ---- */
  function unifiedDiff(aText, bText, nameA, nameB, context) {
    context = Math.max(0, Math.min(20, context === undefined ? 3 : context));
    var a = String(aText == null ? '' : aText).split('\n');
    var b = String(bText == null ? '' : bText).split('\n');
    var script = myersScript(a, b);
    if (!script.some(function (s) { return s.op !== '='; })) return '';
    var head = '--- ' + (nameA || 'a') + '\n+++ ' + (nameB || 'b');
    /* group changes with `context` lines of surrounding equality into hunks —
       INDEX-based grouping (a stream walk drops the boundary context lines) */
    var hunks = [];
    var changeIdx = [];
    script.forEach(function (s, i) { if (s.op !== '=') changeIdx.push(i); });
    var groups = [], g0 = changeIdx[0], prev = changeIdx[0];
    for (var gi = 1; gi < changeIdx.length; gi++) {
      if (changeIdx[gi] - prev > 2 * context + 1) { groups.push([g0, prev]); g0 = changeIdx[gi]; }
      prev = changeIdx[gi];
    }
    groups.push([g0, prev]);
    groups.forEach(function (g) {
      var start = Math.max(0, g[0] - context), end = Math.min(script.length - 1, g[1] + context);
      var lines = [];
      for (var li = start; li <= end; li++) lines.push(script[li]);
      hunks.push({ start: start, end: end, lines: lines });
    });
    /* merge adjacent hunks (overlap or touch) */
    var merged = [];
    hunks.forEach(function (h) {
      var last = merged[merged.length - 1];
      if (last && h.start <= last.end + 1) {
        for (var i = last.end + 1; i <= h.end; i++) last.lines.push(script[i]);
        last.end = h.end;
      } else merged.push(h);
    });
    var out = [head];
    merged.forEach(function (h) {
      var aStart = 0, bStart = 0, aCount = 0, bCount = 0;
      h.lines.forEach(function (s) {
        if (s.op !== '+') { if (aCount === 0) aStart = s.a + 1; aCount++; }
        if (s.op !== '-') { if (bCount === 0) bStart = s.b + 1; bCount++; }
      });
      out.push('@@ -' + aStart + ',' + aCount + ' +' + bStart + ',' + bCount + ' @@');
      h.lines.forEach(function (s) {
        out.push((s.op === '=' ? ' ' : s.op) + (s.op === '=' ? a[s.a] : s.op === '-' ? a[s.a] : b[s.b]));
      });
    });
    return out.join('\n') + '\n';
  }

  /* ---- patch parsing: unified format → structured hunks ---- */
  function parsePatch(patchText) {
    var lines = String(patchText == null ? '' : patchText).split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop(); // the writer's trailing newline is not a phantom line
    var hunks = [], cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('--- ') === 0 || line.indexOf('+++ ') === 0 || line.indexOf('diff ') === 0 || line.indexOf('index ') === 0) continue;
      var m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        cur = { aStart: parseInt(m[1], 10), aCount: m[2] === undefined ? 1 : parseInt(m[2], 10), bStart: parseInt(m[3], 10), bCount: m[4] === undefined ? 1 : parseInt(m[4], 10), lines: [] };
        hunks.push(cur);
        continue;
      }
      if (!cur) continue; // headers/garbage before the first hunk
      if (line.indexOf('\\') === 0) continue; // "\ No newline at end of file"
      if (line.indexOf(' ') === 0) cur.lines.push({ op: '=', t: line.slice(1) });
      else if (line.indexOf('-') === 0) cur.lines.push({ op: '-', t: line.slice(1) });
      else if (line.indexOf('+') === 0) cur.lines.push({ op: '+', t: line.slice(1) });
      else if (line === '' && hunkOpen(cur)) cur.lines.push({ op: '=', t: '' }); // empty context line
    }
    return hunks;
    /* an empty line counts as context only while the hunk still expects lines */
    function hunkOpen(h) {
      var seen = 0;
      h.lines.forEach(function (l) { seen++; });
      return seen < h.aCount + h.bCount;
    }
  }

  /* ---- patch application with fuzz (context drift tolerance) ----
     Returns {ok, result} or {ok: false, error, hunk: failingIndex}. */
  function applyPatch(aText, patchText, opts) {
    opts = opts || {};
    var fuzz = opts.fuzz === undefined ? 2 : opts.fuzz;
    var a = String(aText == null ? '' : aText).split('\n');
    var hunks = parsePatch(patchText);
    if (!hunks.length) return { ok: false, error: 'no hunks in patch', hunk: -1 };
    var pos = 0; // 0-based index into `a` of the next untouched line
    var out = [];
    for (var h = 0; h < hunks.length; h++) {
      var hk = hunks[h];
      /* the context+removal lines this hunk expects to find */
      var expect = [];
      hk.lines.forEach(function (l) { if (l.op !== '+') expect.push(l.t); });
      /* locate: start at the hunk's declared position (1-based → 0-based),
         drift up to ±fuzz lines seeking the best context match */
      var want = Math.max(0, hk.aStart - 1);
      var at = -1;
      for (var drift = 0; drift <= fuzz && at < 0; drift++) {
        if (matchesAt(a, expect, want + drift)) at = want + drift;
        else if (drift > 0 && matchesAt(a, expect, want - drift)) at = want - drift;
      }
      if (at < 0) return { ok: false, error: 'hunk #' + (h + 1) + ' failed: context not found near line ' + (want + 1), hunk: h };
      /* emit untouched lines up to the hunk, then the hunk's result */
      while (pos < at) out.push(a[pos++]);
      hk.lines.forEach(function (l) {
        if (l.op === '=') out.push(a[pos++]);
        else if (l.op === '-') pos++;
        else out.push(l.t);
      });
    }
    while (pos < a.length) out.push(a[pos++]);
    return { ok: true, result: out.join('\n') };
  }
  function matchesAt(a, expect, at) {
    if (at < 0 || at + expect.length > a.length) return false;
    for (var i = 0; i < expect.length; i++) if (a[at + i] !== expect[i]) return false;
    return true;
  }

  /* ---- three-way merge: base, ours, theirs ----
     Non-overlapping changes auto-merge; identical changes collapse;
     overlapping different changes become structured conflicts. */
  /* ---- three-way merge: base, ours, theirs ----
     Each side's diff vs base becomes a map: baseIndex → replacement group.
     Walking the base lines: one side changed → take it; both changed
     identically → collapse; both changed differently → a structured
     conflict (with git-style markers in the merged text). */
  function threeWayMerge(baseText, oursText, theirsText) {
    var NL = String.fromCharCode(10);
    var base = String(baseText == null ? '' : baseText).split(NL);
    var ours = String(oursText == null ? '' : oursText).split(NL);
    var theirs = String(theirsText == null ? '' : theirsText).split(NL);
    var oScript = myersScript(base, ours);
    var tScript = myersScript(base, theirs);
    /* per side: baseIndex → {delFrom, delTo, adds[]} for each change group */
    function sideMap(script, side) {
      var map = {}, k = 0, bi = 0;
      while (k < script.length) {
        if (script[k].op === '=') { bi = script[k].a + 1; k++; continue; }
        var delFrom = -1, delTo = -1, adds = [];
        while (k < script.length && script[k].op !== '=') {
          if (script[k].op === '-') { if (delFrom < 0) delFrom = script[k].a; delTo = script[k].a; }
          else adds.push(side[script[k].b]);
          k++;
        }
        map[delFrom >= 0 ? delFrom : bi] = { delFrom: delFrom, delTo: delTo, adds: adds };
        if (delTo >= 0) bi = delTo + 1;
      }
      return map;
    }
    var oMap = sideMap(oScript, ours), tMap = sideMap(tScript, theirs);
    var editPoints = {};
    Object.keys(oMap).concat(Object.keys(tMap)).forEach(function (k) { editPoints[k] = 1; });
    var points = Object.keys(editPoints).map(Number).sort(function (a, b) { return a - b; });
    var merged = [], conflicts = [];
    var bi = 0, ep = 0;
    while (bi < base.length) {
      var at = points[ep];
      if (at === undefined || at > bi) { merged.push(base[bi]); bi++; continue; }
      ep++;
      var oo = oMap[at], tt = tMap[at];
      var oEnd = oo && oo.delTo !== undefined ? oo.delTo : at - 1;
      var tEnd = tt && tt.delTo !== undefined ? tt.delTo : at - 1;
      var end = Math.max(oEnd, tEnd);
      if (oo && tt) {
        var same = oo.delFrom === tt.delFrom && oo.delTo === tt.delTo &&
          oo.adds.length === tt.adds.length &&
          oo.adds.every(function (l, ix) { return l === tt.adds[ix]; });
        if (same) {
          oo.adds.forEach(function (l) { merged.push(l); });
        } else {
          conflicts.push({
            base: base.slice(at, end + 1).join(NL),
            ours: oo.adds.join(NL),
            theirs: tt.adds.join(NL)
          });
          merged.push('<<<<<<< ours');
          oo.adds.forEach(function (l) { merged.push(l); });
          merged.push('=======');
          tt.adds.forEach(function (l) { merged.push(l); });
          merged.push('>>>>>>> theirs');
        }
      } else if (oo) {
        oo.adds.forEach(function (l) { merged.push(l); });
      } else {
        tt.adds.forEach(function (l) { merged.push(l); });
      }
      bi = end + 1;
    }
    return { merged: merged.join(NL), conflicts: conflicts, clean: conflicts.length === 0 };
  }

  /* ---- word / char diffs (small strings) ---- */
  function tokenizeWords(s) { return String(s == null ? '' : s).match(/\S+|\s+/g) || []; }
  function wordDiff(aText, bText) {
    var script = myersScript(tokenizeWords(aText), tokenizeWords(bText));
    var aw = tokenizeWords(aText), bw = tokenizeWords(bText);
    return script.map(function (s) {
      return { op: s.op, text: s.op === '=' ? aw[s.a] : s.op === '-' ? aw[s.a] : bw[s.b] };
    });
  }
  function charDiff(aText, bText) {
    var a = String(aText == null ? '' : aText).split(''), b = String(bText == null ? '' : bText).split('');
    var script = myersScript(a, b);
    return script.map(function (s) {
      return { op: s.op, ch: s.op === '=' ? a[s.a] : s.op === '-' ? a[s.a] : b[s.b] };
    });
  }

  /* ---- similarity (rename detection): line-set Jaccard × length ratio ---- */
  function similarity(aText, bText) {
    var a = String(aText == null ? '' : aText).split('\n'), b = String(bText == null ? '' : bText).split('\n');
    var setA = {}, setB = {};
    a.forEach(function (l) { if (l.trim()) setA[l.trim()] = 1; });
    b.forEach(function (l) { if (l.trim()) setB[l.trim()] = 1; });
    var ka = Object.keys(setA), kb = Object.keys(setB);
    if (!ka.length && !kb.length) return 1;
    var inter = 0;
    ka.forEach(function (l) { if (setB[l]) inter++; });
    var union = ka.length + kb.length - inter;
    var jaccard = union ? inter / union : 0;
    /* length only modulates — disjoint content must stay near zero */
    var lenRatio = Math.min(a.length, b.length) / Math.max(1, Math.max(a.length, b.length));
    return Math.round(jaccard * (0.6 + 0.4 * lenRatio) * 100) / 100;
  }

  /* ---- side-by-side alignment (the IDE diff view's data) ----
     rows: [{left: {t, op}|null, right: {t, op}|null}] — op ∈ =,-,+. */
  function alignSides(aText, bText) {
    var a = String(aText == null ? '' : aText).split('\n');
    var b = String(bText == null ? '' : bText).split('\n');
    var script = myersScript(a, b);
    var rows = [];
    var i = 0;
    while (i < script.length) {
      var s = script[i];
      if (s.op === '=') { rows.push({ left: { t: a[s.a], op: '=' }, right: { t: b[s.b], op: '=' } }); i++; continue; }
      /* collect a contiguous del/add block and pair it row-wise */
      var dels = [], adds = [];
      while (i < script.length && script[i].op !== '=') {
        if (script[i].op === '-') dels.push(a[script[i].a]);
        else adds.push(b[script[i].b]);
        i++;
      }
      var rowsN = Math.max(dels.length, adds.length);
      for (var r = 0; r < rowsN; r++) {
        rows.push({
          left: r < dels.length ? { t: dels[r], op: '-' } : null,
          right: r < adds.length ? { t: adds[r], op: '+' } : null
        });
      }
    }
    return rows;
  }

  return {
    myersScript: myersScript,
    unifiedDiff: unifiedDiff,
    parsePatch: parsePatch,
    applyPatch: applyPatch,
    threeWayMerge: threeWayMerge,
    wordDiff: wordDiff,
    charDiff: charDiff,
    similarity: similarity,
    alignSides: alignSides
  };
});
