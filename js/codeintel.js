/* REVA — Code Intelligence (foundation: jump-to-definition + find-references).
   A pure symbol index over a file map: definitions (function/class/
   const-fn/method declarations) and references (every other word-boundary
   occurrence), with jump-target resolution (same file wins). Static regex
   analysis, Mimosa-safe toolkit. Treesitter upgrade path noted, not required.
   Pure UMD: identical code in node tests and the WebView. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CODEINTEL = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  function push(index, name, path, line, kind) {
    if (!index[name]) index[name] = [];
    index[name].push({ path: path, line: line, kind: kind });
  }

  /* per-line definition extraction: function/class/const-fn/indented method */
  var DEF_FN = /(?:^|[^\w.$])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
  var DEF_DEF = /(?:^|[^\w.$])(?:def|fn)\s+([A-Za-z_$][\w$]*)/g; /* python/ruby def, rust fn */
  var DEF_CLASS = /(?:^|[^\w.$])class\s+([A-Za-z_$][\w$]*)/g;
  var DEF_CONSTFN = /(?:^|[^\w.$])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)/g;
  var DEF_METHOD = /^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/;
  var SKIP = ['if', 'for', 'while', 'switch', 'catch', 'function', 'return'];

  function lineDefs(text) {
    var names = [];
    var m;
    var fns = text.matchAll(DEF_FN);
    for (m = fns.next(); !m.done; m = fns.next()) names.push(m.value[1]);
    var dfs = text.matchAll(DEF_DEF);
    for (m = dfs.next(); !m.done; m = dfs.next()) names.push(m.value[1]);
    var cls = text.matchAll(DEF_CLASS);
    for (m = cls.next(); !m.done; m = cls.next()) names.push(m.value[1]);
    var cfs = text.matchAll(DEF_CONSTFN);
    for (m = cfs.next(); !m.done; m = cfs.next()) names.push(m.value[1]);
    var meth = text.match(DEF_METHOD);
    if (meth && SKIP.indexOf(meth[1]) < 0) names.push(meth[1]);
    return names;
  }

  function buildIndex(files) {
    var index = {};
    Object.keys(files || {}).filter(function (p) {
      return /\.(js|ts|mjs|cjs|jsx|py|java|c|cpp|h|go|rs|php|sh)$/.test(p);
    }).forEach(function (path) {
      String(files[path] || '').split('\n').forEach(function (text, i) {
        var lineNo = i + 1;
        var defs = lineDefs(text);
        var defSet = {};
        defs.forEach(function (n) { defSet[n] = 1; });
        /* definition rows first (one row per name defined on the line) */
        defs.forEach(function (n) { push(index, n, path, lineNo, 'def'); });
        /* references: every identifier that is NOT a def on this line */
        var idents = text.matchAll(/\b[A-Za-z_$][\w$]*\b/g);
        var seen = {};
        for (var it = idents.next(); !it.done; it = idents.next()) {
          var name = it.value[0];
          if (defSet[name] || seen[name]) continue;
          seen[name] = 1;
          push(index, name, path, lineNo, 'ref');
        }
      });
    });
    Object.keys(index).forEach(function (k) {
      index[k].sort(function (a, b) { return a.line - b.line || (a.path < b.path ? -1 : 1); });
    });
    return index;
  }

  /* definitions(name): only the declaration rows */
  function definitions(index, name) {
    return (index[name] || []).filter(function (r) { return r.kind === 'def'; });
  }

  /* references(name): the usage rows (definitions excluded) */
  function references(index, name) {
    return (index[name] || []).filter(function (r) { return r.kind === 'ref'; });
  }

  /* jumpTarget(name, currentPath): best definition — same file wins, then
     the first across files (rows are line-sorted, so this is deterministic). */
  function jumpTarget(index, name, currentPath) {
    var defs = definitions(index, name);
    if (!defs.length) return null;
    if (currentPath) {
      var same = defs.filter(function (d) { return d.path === currentPath; });
      if (same.length) return same[0];
    }
    return defs[0];
  }

  return {
    buildIndex: buildIndex,
    definitions: definitions,
    references: references,
    jumpTarget: jumpTarget
  };
});
