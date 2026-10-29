/* REVA — repo-map (L3 context engine).
   Aider's idea, adapted: extract the symbols of every file in a mounted
   project (tree-sitter AST when the engine is up, regex fallback when not),
   count cross-file references by token frequency, rank files by structural
   importance, and render a compact map that rides the system prompt — so
   the model navigates a 100-file project deliberately instead of searching.
   Pure core (UMD): identical code in node tests and the WebView. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.REVAMAP = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  var FILE_CAP = 300 * 1024;   // skip monsters; they get their own reads
  var MAX_FILES = 400;
  var DEFAULT_BUDGET = 1400;   // chars of prompt space
  var MAX_SYMS_PER_FILE = 8;

  var KIND_W = { func: 3, method: 2, 'class': 4, 'interface': 3, struct: 3, 'enum': 3, trait: 3, 'module': 2, object: 2, type: 1 };

  /* regex fallback extractor — for langs without a grammar or when the
     tree-sitter engine is unavailable. Ordered: first match per line wins. */
  var FALLBACK = [
    { re: /^[\t ]*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm, kind: 'func' },
    { re: /^[\t ]*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm, kind: 'class' },
    { re: /^[\t ]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/gm, kind: 'func' },
    { re: /^[\t ]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function/gm, kind: 'func' },
    { re: /^[\t ]*def\s+([A-Za-z_][\w]*)/gm, kind: 'func' },
    { re: /^[\t ]*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/gm, kind: 'func' },
    { re: /^[\t ]*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/gm, kind: 'func' },
    { re: /^[\t ]*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_][\w]*)/gm, kind: 'struct' },
    { re: /^[\t ]*(?:public|private|protected)?[\w<>\[\]]*\s*(?:interface)\s+([A-Za-z_][\w]*)/gm, kind: 'interface' }
  ];

  function extractFallback(lang, src) {
    var out = [];
    for (var i = 0; i < FALLBACK.length; i++) {
      var f = FALLBACK[i];
      f.re.lastIndex = 0;
      var m;
      while ((m = f.re.exec(src))) {
        var line = src.slice(0, m.index).split('\n').length;
        out.push({ kind: f.kind, name: m[1], line: line });
        if (out.length > 500) break;
      }
    }
    out.sort(function (a, b) { return a.line - b.line; });
    return out;
  }

  /* token frequency per file — the cheap reference graph */
  function tokenize(src) {
    var freq = {};
    var toks = String(src).match(/[A-Za-z_$][\w$]*/g) || [];
    for (var i = 0; i < toks.length; i++) freq[toks[i]] = (freq[toks[i]] || 0) + 1;
    return freq;
  }

  /* filesObj: { path: content }. resolveSymbols: optional async
     (path, content) → { lang, symbols } | null (the tree-sitter engine's
     symbolsFor); null/absent → the regex fallback extractor runs. */
  function build(filesObj, resolveSymbols, label, budget) {
    budget = budget || DEFAULT_BUDGET;
    var paths = Object.keys(filesObj || {}).filter(function (p) {
      var c = filesObj[p];
      return typeof c === 'string' && c.indexOf('data:') !== 0 && c.length <= FILE_CAP;
    }).sort();
    if (paths.length > MAX_FILES) paths = paths.slice(0, MAX_FILES);
    var extOf = function (p) { return (p.split('.').pop() || '').toLowerCase(); };
    /* files with code extensions only — unmapped types don't pollute the map */
    var CODE_EXT = /^(js|mjs|cjs|jsx|ts|tsx|py|html?|css|json|sh|bash|c|h|cpp|cc|hpp|java|kt|rs|go|php|rb|lua|sql|ya?ml)$/;
    paths = paths.filter(function (p) { return CODE_EXT.test(extOf(p)); });

    var index = {}; // path → {lang, symbols}
    var jobs = paths.map(function (p) {
      return Promise.resolve(resolveSymbols ? resolveSymbols(p, filesObj[p]) : null)
        .then(function (r) {
          var syms = (r && r.symbols && r.symbols.length) ? r.symbols : extractFallback(extOf(p), filesObj[p]);
          if (syms.length) index[p] = { lang: (r && r.lang) || 'fallback', symbols: syms };
        })
        .catch(function () { });
    });

    return Promise.all(jobs).then(function () {
      /* reference counts: same-file vs cross-file */
      var freqs = {};
      paths.forEach(function (p) { freqs[p] = tokenize(filesObj[p]); });
      var scored = [];
      Object.keys(index).forEach(function (p) {
        var fileScore = 0;
        var syms = index[p].symbols.map(function (sy) {
          var same = 0, cross = 0;
          paths.forEach(function (q) {
            var n = freqs[q][sy.name] || 0;
            if (!n) return;
            if (q === p) same += n; else cross += n;
          });
          var w = KIND_W[sy.kind] || 1;
          var s = w * (1 + Math.log(1 + 2 * cross + same));
          fileScore += s;
          return { kind: sy.kind, name: sy.name, line: sy.line, score: s };
        });
        scored.push({ path: p, score: fileScore, symbols: syms });
      });
      scored.sort(function (a, b) { return b.score - a.score; });
      return render(scored, label, budget);
    });

    function render(scored, label, budget) {
      var head = 'PROJECT MAP — ' + (label || 'project') + ' (' + paths.length + ' code files, ranked by structural importance)';
      var lines = [head];
      var used = head.length;
      for (var i = 0; i < scored.length; i++) {
        var f = scored[i];
        var syms = f.symbols.slice().sort(function (a, b) { return b.score - a.score; }).slice(0, MAX_SYMS_PER_FILE);
        var line = '  ' + f.path + ' — ' + (syms.length ? syms.map(function (s) { return s.kind + ' ' + s.name + ' (L' + s.line + ')'; }).join(', ') : '(no named symbols)');
        if (used + line.length > budget && i > 0) { lines.push('  … ' + (scored.length - i) + ' more files (use list_files / code_symbols)'); break; }
        lines.push(line);
        used += line.length + 1;
      }
      lines.push('(Navigate with code_symbols for full outlines; this map updates as you edit.)');
      return { text: lines.join('\n'), sig: sig() };
    }

    function sig() {
      var n = 0, bytes = 0;
      Object.keys(filesObj || {}).forEach(function (p) { n++; bytes += String(filesObj[p] || '').length; });
      return n + ':' + bytes;
    }
  }

  return { build: build, extractFallback: extractFallback, tokenize: tokenize, DEFAULT_BUDGET: DEFAULT_BUDGET };
});
