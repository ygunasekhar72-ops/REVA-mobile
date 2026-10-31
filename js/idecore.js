/* REVA — IDE core (pure, unit-tested). The IDE's intelligence lives here so
   node tests exercise the exact code the WebView editor runs:
   - buildTree: flat path list → hierarchical tree for the file explorer
   - searchWorkspace: ranked cross-file search (substring + token overlap)
   - autocomplete: prefix completion over document identifiers + language
     keywords, frequency-ranked
   - autoIndent / bracketAuto / wordAt: the editor's typing intelligence
   Works in the browser (window.IDECORE) and node (module.exports). */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IDECORE = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  /* ---- file tree: flat {path} list → nested {dirs:{name:node}, files:[]} ----
     A folder node is { name, dirs, files } where files are {name, path}.
     Folders sort first, both alphabetically — the classic explorer order. */
  function buildTree(paths) {
    var root = { name: '', dirs: {}, files: [] };
    (paths || []).forEach(function (p) {
      var parts = String(p).split('/');
      var node = root;
      for (var i = 0; i < parts.length - 1; i++) {
        var seg = parts[i] || '';
        if (!seg) continue;
        if (!node.dirs[seg]) node.dirs[seg] = { name: seg, dirs: {}, files: [] };
        node = node.dirs[seg];
      }
      var fname = parts[parts.length - 1];
      if (fname) node.files.push({ name: fname, path: p });
    });
    function finalize(n) {
      var t = { name: n.name, dirs: {}, files: n.files.slice().sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; }) };
      Object.keys(n.dirs).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; })
        .forEach(function (d) { t.dirs[d] = finalize(n.dirs[d]); });
      return t;
    }
    return finalize(root);
  }

  /* flatten a tree back to display rows: dirs (with depth) then files */
  function flattenTree(node, depth, out, collapsed) {
    depth = depth || 0; out = out || [];
    Object.keys(node.dirs).forEach(function (d) {
      var isCol = collapsed && collapsed[node.dirs[d].name + '/' + depth] === true;
      out.push({ kind: 'dir', name: node.dirs[d].name, depth: depth, collapsed: isCol });
      if (!isCol) flattenTree(node.dirs[d], depth + 1, out, collapsed);
    });
    node.files.forEach(function (f) { out.push({ kind: 'file', name: f.name, path: f.path, depth: depth }); });
    return out;
  }

  /* ---- workspace search: rank = file coverage × line overlap ----
     Pass 1: how much of the query each FILE covers (files that contain more
     of the query rank above files that contain less — file-level relevance).
     Pass 2: score lines inside those files (substring hit > token hits).
     Returns [{path, line, text}] best-first, capped at maxResults. */
  function searchWorkspace(filesObj, query, maxResults) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    var toks = q.split(/\s+/).filter(Boolean);
    var cover = {};
    Object.keys(filesObj || {}).forEach(function (p) {
      var low = String(filesObj[p] || '').toLowerCase();
      var n = 0;
      toks.forEach(function (t) { if (low.indexOf(t) >= 0) n++; });
      cover[p] = n;
    });
    var out = [];
    Object.keys(filesObj || {}).forEach(function (p) {
      var src = String(filesObj[p] || '');
      if (!src) return;
      var lines = src.split('\n');
      var pathScore = p.toLowerCase().indexOf(q) >= 0 ? 2 : 0;
      for (var i = 0; i < lines.length; i++) {
        var low = lines[i].toLowerCase();
        if (low.indexOf(q) < 0 && !toks.some(function (t) { return t.length > 2 && low.indexOf(t) >= 0; })) continue;
        var sc = cover[p] * 4 + pathScore * 3;
        if (low.indexOf(q) >= 0) sc += 6;
        toks.forEach(function (t) { if (t.length > 2 && low.indexOf(t) >= 0) sc += 1; });
        out.push({ path: p, line: i + 1, text: lines[i].trim().slice(0, 160), score: sc });
      }
    });
    out.sort(function (a, b) { return b.score - a.score || (a.path < b.path ? -1 : 1) || a.line - b.line; });
    return out.slice(0, maxResults || 50);
  }

  /* ---- autocomplete: doc identifiers + language keywords ----
     dict: { keywords: [...], builtins: [...] } (see ide-keywords.js).
     Returns { word, start, items } — items best-first, capped. */
  function autocomplete(text, pos, lang, dict) {
    text = String(text == null ? '' : text);
    var w = wordAt(text, pos);
    if (!w.word || w.word.length < 2) return { word: w.word || '', start: w.start, items: [] };
    var low = w.word.toLowerCase();
    /* frequency of identifiers in THIS document — local names rank first */
    var freq = {};
    var toks = text.match(/[A-Za-z_$][\w$]{2,}/g) || [];
    for (var i = 0; i < toks.length; i++) freq[toks[i]] = (freq[toks[i]] || 0) + 1;
    var seen = {}, items = [];
    function add(name, src) {
      if (seen[name]) return;
      if (name === w.word) return;
      if (name.toLowerCase().indexOf(low) !== 0) return; // prefix match only
      seen[name] = 1;
      items.push({ name: name, src: src, score: (freq[name] || 0) * 2 + (src === 'doc' ? 3 : 0) });
    }
    Object.keys(freq).forEach(function (n) { add(n, 'doc'); });
    ((dict && dict.keywords) || []).forEach(function (n) { add(n, 'kw'); });
    ((dict && dict.builtins) || []).forEach(function (n) { add(n, 'bi'); });
    items.sort(function (a, b) { return b.score - a.score || (a.name < b.name ? -1 : 1); });
    return { word: w.word, start: w.start, items: items.slice(0, 12) };
  }

  /* the word under/ending at caret — identifiers only, no partial operators */
  function wordAt(text, pos) {
    text = String(text == null ? '' : text);
    var i = Math.max(0, Math.min(pos, text.length));
    var end = i;
    while (end < text.length && /[\w$]/.test(text[end])) end++;
    var start = i;
    while (start > 0 && /[\w$]/.test(text[start - 1])) start--;
    return { word: text.slice(start, end), start: start, end: end };
  }

  /* ---- typing intelligence ----
     autoIndent(text, caret, opening): compute the insert for Enter.
     Keeps the current line's indentation; adds one level when the line ends
     with an opener; aligns with the opener when the next char is a closer. */
  var OPENERS = '{([';
  var CLOSERS = '})]';
  function autoIndent(text, caret) {
    var lineStart = text.lastIndexOf('\n', caret - 1) + 1;
    var line = text.slice(lineStart, caret);
    var indent = (line.match(/^[ \t]*/) || [''])[0];
    /* net bracket depth of this line — paired () on the same line don't count */
    var depth = 0;
    for (var i = 0; i < line.length; i++) {
      if (OPENERS.indexOf(line[i]) >= 0) depth++;
      else if (CLOSERS.indexOf(line[i]) >= 0) depth = Math.max(0, depth - 1);
    }
    var nextCh = (text.slice(caret).match(/^\s*[}\])]/) || [''])[0].trim()[0];
    if (nextCh && depth > 0) {
      /* between |} — the closer stays, our content indents one deeper */
      return { indent: indent + '  ', skipIndent: true };
    }
    if (depth > 0) return { indent: indent + '  ', skipIndent: false };
    if (nextCh && !line.trim()) {
      /* empty line right before a closer: align with the ENCLOSING opener's
         child level — the classic Enter-between-brackets fixup */
      var prevLines = text.slice(0, lineStart).split('\n');
      for (var k = prevLines.length - 1; k >= 0; k--) {
        var pl = prevLines[k];
        if (!pl.trim()) continue;
        var pd = 0;
        for (var j = 0; j < pl.length; j++) {
          if (OPENERS.indexOf(pl[j]) >= 0) pd++;
          else if (CLOSERS.indexOf(pl[j]) >= 0) pd = Math.max(0, pd - 1);
        }
        if (pd > 0) return { indent: (pl.match(/^[ \t]*/) || [''])[0] + '  ', skipIndent: true };
        break;
      }
      return { indent: indent, skipIndent: true };
    }
    return { indent: indent, skipIndent: false };
  }

  /* bracketAuto(ch, after): ch just typed, after = char to the right of caret.
     Returns the closing char to insert (or null) — never inside a word or
     before a non-space (string interpolation foot-guns stay out). */
  var PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
  function bracketAuto(ch, after) {
    var close = PAIRS[ch];
    if (!close) return null;
    var wordish = /[\w$/\\]/;
    if (ch === close) return null; // quotes handled by overtype, not dup
    if (after && (wordish.test(after) || after === close)) return null;
    return close;
  }

  /* line:col of a caret offset — for the status bar */
  function lineCol(text, caret) {
    var before = String(text == null ? '' : text).slice(0, caret);
    var line = before.split('\n').length;
    var col = caret - (before.lastIndexOf('\n') + 1) + 1;
    return { line: line, col: col };
  }

  /* ---- Phase B: find/replace ----
     findMatches: case/regex/whole-word toggles, ordered, capped at 500.
     Invalid regex → null (caller keeps its honest error).
     compileUserRegex: the ONLY place user text becomes a RegExp. The pattern
     is the user's own find-query against their own file (a ReDoS concern at
     worst — capped at 500 matches), never a host/command surface. */
  var FIND_CAP = 500;
  function compileUserRegex(pattern, flags) {
    if (!pattern || pattern.length > 300 || pattern.indexOf('\0') >= 0) return null;
    try { return new RegExp(pattern, flags); } catch (e) { return null; }
  }
  /* regex-escape via function replacer — every metachar gets an explicit
     backslash, no interpolation tokens involved */
  function reEsc(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, function (c) { return '\\' + c; });
  }
  function findMatches(text, query, opts) {
    text = String(text == null ? '' : text);
    var q = String(query == null ? '' : query);
    if (!q) return [];
    opts = opts || {};
    var re;
    if (opts.regex) {
      re = compileUserRegex(q, opts.caseSensitive ? 'g' : 'gi');
      if (!re) return null;
    } else {
      var esc = reEsc(q);
      if (opts.wholeWord) esc = '\\b(?:' + esc + ')\\b';
      re = compileUserRegex(esc, opts.caseSensitive ? 'g' : 'gi');
      if (!re) return null;
    }
    var out = [], m, lineStarts = null;
    while ((m = re.exec(text))) {
      if (m[0].length === 0) { re.lastIndex++; continue; } // guard a? zero-length
      if (!lineStarts) {
        lineStarts = [0];
        for (var i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
      }
      var lo = 0, hi = lineStarts.length - 1, ln = 1;
      while (lo <= hi) { var mid = (lo + hi) >> 1; if (lineStarts[mid] <= m.index) { ln = mid + 1; lo = mid + 1; } else hi = mid - 1; }
      out.push({ start: m.index, end: m.index + m[0].length, line: ln });
      if (out.length >= FIND_CAP) break;
    }
    return out;
  }
  /* replaceAll built on the same matcher — ranges applied back-to-front */
  function replaceAll(text, query, replacement, opts) {
    var ms = findMatches(text, query, opts);
    if (ms === null) return null;
    if (!ms.length) return { text: String(text), count: 0 };
    var s = String(text);
    for (var i = ms.length - 1; i >= 0; i--) s = s.slice(0, ms[i].start) + String(replacement == null ? '' : replacement) + s.slice(ms[i].end);
    return { text: s, count: ms.length };
  }

  /* ---- Phase B: bracket matching ----
     From the caret: if beside a bracket, find its partner with depth
     counting. Limitation (documented): not string/comment aware. */
  var BR_OPEN = '([{', BR_CLOSE = ')]}';
  function bracketMatch(text, pos) {
    text = String(text == null ? '' : text);
    var before = text[pos - 1], after = text[pos];
    var ch, dir, start;
    if (before && BR_OPEN.indexOf(before) >= 0) { ch = before; dir = 1; start = pos - 1; }
    else if (after && BR_CLOSE.indexOf(after) >= 0) { ch = after; dir = -1; start = pos; }
    else if (before && BR_CLOSE.indexOf(before) >= 0) { ch = before; dir = -1; start = pos - 1; }
    else if (after && BR_OPEN.indexOf(after) >= 0) { ch = after; dir = 1; start = pos; }
    else return null;
    var want = dir === 1 ? BR_CLOSE[BR_OPEN.indexOf(ch)] : BR_OPEN[BR_CLOSE.indexOf(ch)];
    var depth = 0;
    for (var i = start; i >= 0 && i < text.length; i += dir) {
      var c = text[i];
      if (c === ch) depth++;
      else if (c === want && --depth === 0) return { a: Math.min(start, i), b: Math.max(start, i) };
    }
    return null;
  }

  /* ---- Phase B: change markers (gutter) — saved vs edited ----
     Vendored jsdiff line hunks, walked into per-line statuses:
     add | del | mod. Fallback: any line differing from saved → mod. */
  function changeMarkers(saved, current) {
    var S = String(saved == null ? '' : saved), C = String(current == null ? '' : current);
    var marks = {};
    if (S === C) return marks;
    var D = null;
    if (typeof window !== 'undefined' && window.Diff) D = window.Diff;
    else if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try { D = require('../js/vendor/diff/jsdiff.js'); } catch (e) { }
    }
    if (!D || !D.diffLines) {
      var a = S.split('\n'), b = C.split('\n');
      for (var j = 0; j < b.length; j++) if (a[j] !== b[j]) marks[j + 1] = 'mod';
      return marks;
    }
    var hunks = D.diffLines(S, C);
    var oldLn = 0, newLn = 0;
    for (var h = 0; h < hunks.length; h++) {
      var hk = hunks[h];
      var cnt = hk.count || String(hk.value).split('\n').length - 1;
      if (hk.removed) {
        for (var r = 0; r < cnt; r++) marks[++oldLn] = 'del';
      } else if (hk.added) {
        /* a removed+added pair = modified for the positional overlap
           (min of the two counts), genuinely added for the remainder */
        var prev = h > 0 && hunks[h - 1].removed ? hunks[h - 1] : null;
        var prevCnt = prev ? (prev.count || String(prev.value).split('\n').length - 1) : 0;
        var K = prev ? Math.min(prevCnt, cnt) : 0;
        for (var ad = 0; ad < cnt; ad++) marks[++newLn] = ad < K ? 'mod' : 'add';
      } else {
        oldLn += cnt; newLn += cnt;
      }
    }
    return marks;
  }

  /* ---- Phase B: command palette fuzzy score ----
     Prefix >> contiguous substring >> in-order subsequence; 0 = no match. */
  function paletteScore(query, label) {
    var q = String(query || '').toLowerCase().trim();
    var l = String(label || '').toLowerCase();
    if (!q) return 1;
    if (l.indexOf(q) === 0) return 100 - l.length * 0.01;
    var idx = l.indexOf(q);
    if (idx > 0) return 60 - idx - l.length * 0.01;
    /* subsequence with contiguity bonus */
    var li = 0, streak = 0, best = 0, score = 0;
    for (var i = 0; i < q.length; i++) {
      var found = l.indexOf(q[i], li);
      if (found < 0) return 0;
      streak = found === li ? streak + 1 : 1;
      best = Math.max(best, streak);
      score += 2 + streak;
      li = found + 1;
    }
    return Math.min(50, score + best * 2);
  }

  return {
    buildTree: buildTree,
    flattenTree: flattenTree,
    searchWorkspace: searchWorkspace,
    autocomplete: autocomplete,
    wordAt: wordAt,
    autoIndent: autoIndent,
    bracketAuto: bracketAuto,
    lineCol: lineCol,
    findMatches: findMatches,
    replaceAll: replaceAll,
    bracketMatch: bracketMatch,
    changeMarkers: changeMarkers,
    paletteScore: paletteScore
  };
});
