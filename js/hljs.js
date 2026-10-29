/* REVA — highlight.js loader (leverage doctrine: highlight.js MIT, vendored
   unminified from npm — see scripts/vendor-hljs.sh, THIRD_PARTY_NOTICES.md).
   The vendored files are CommonJS; this loader shims `module` per script so
   they run as plain <script> tags in the WebView. Core + a common set load
   in the background; all 386 languages load on demand and cache. Every
   failure resolves null → callers keep their regex fallback (H.hl). */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HLJS = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  /* file extension → highlight.js language name (hljs names HTML 'xml') */
  var EXT = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', html: 'xml', htm: 'xml', svg: 'xml', xml: 'xml', vue: 'xml',
    css: 'css', json: 'json', sh: 'bash', bash: 'bash', zsh: 'bash',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
    java: 'java', kt: 'kotlin', kts: 'kotlin', rs: 'rust', go: 'go',
    php: 'php', rb: 'ruby', lua: 'lua', sql: 'sql', yml: 'yaml', yaml: 'yaml',
    md: 'markdown', toml: 'ini', ini: 'ini', conf: 'ini', cfg: 'ini',
    mk: 'makefile', makefile: 'makefile', dockerfile: 'dockerfile',
    swift: 'swift', dart: 'dart', pl: 'perl', pm: 'perl', r: 'r',
    scala: 'scala', hs: 'haskell', ex: 'elixir', exs: 'elixir', erl: 'erlang',
    clj: 'clojure', vb: 'vbnet', f90: 'fortran', pas: 'delphi', asm: 'x86asm',
    gradle: 'gradle', groovy: 'groovy', tf: 'hcl', ps1: 'powershell',
    diff: 'diff', patch: 'diff', apache: 'apache', nginx: 'nginx'
  };
  /* registered in the background right after core loads */
  var COMMON = ['javascript', 'typescript', 'xml', 'css', 'python', 'json', 'bash', 'cpp', 'c', 'java', 'rust', 'go', 'php', 'ruby', 'kotlin', 'sql', 'yaml', 'markdown', 'ini', 'lua'];

  function extLang(nameOrExt) {
    var e = String(nameOrExt || '').toLowerCase();
    var m = /\.([a-z0-9]+)$/.exec(e);
    if (m) e = m[1]; // accept a full path/file name too
    return EXT[e] || null;
  }

  /* ---- browser glue ---- */
  var state = { corePromise: null, coreOk: false, langCache: {} };

  function loadScriptCJS(src) {
    return new Promise(function (res, rej) {
      var m = { exports: {} };
      var prev = window.module;
      window.module = m;
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { window.module = prev; res(m.exports); };
      s.onerror = function () { window.module = prev; rej(new Error('hljs load failed: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function core() {
    if (state.corePromise) return state.corePromise;
    state.corePromise = loadScriptCJS('js/vendor/hljs/core.js').then(function (exp) {
      window.hljs = exp;
      state.coreOk = true;
      /* common languages register in the background — never block a highlight */
      COMMON.forEach(function (l) { ensureLang(l).catch(function () { }); });
      return exp;
    });
    return state.corePromise;
  }

  function ensureLang(name) {
    return core().then(function (hljs) {
      if (hljs.getLanguage(name)) return true;
      if (!state.langCache[name]) {
        state.langCache[name] = loadScriptCJS('js/vendor/hljs/languages/' + name + '.js').then(function (fn) {
          hljs.registerLanguage(name, fn);
          return true;
        }).catch(function (e) {
          delete state.langCache[name]; // allow a retry later
          throw e;
        });
      }
      return state.langCache[name];
    });
  }

  /* highlight(src, extOrName) → Promise<html | null>; null = use the fallback */
  function highlight(src, extOrName) {
    if (typeof document === 'undefined') return Promise.resolve(null); // node tests drive hljs directly
    var lang = extLang(extOrName) || (/^[a-z0-9+#-]+$/i.test(String(extOrName || '')) ? String(extOrName).toLowerCase() : null);
    if (!lang) return Promise.resolve(null);
    return ensureLang(lang).then(function (ok) {
      if (!ok) return null;
      try { return window.hljs.highlight(String(src), { language: lang, ignoreIllegals: true }).value; }
      catch (e) { return null; }
    }).catch(function () { return null; });
  }

  return { highlight: highlight, extLang: extLang, EXT: EXT, COMMON: COMMON, ensureLang: ensureLang, isLoaded: function () { return state.coreOk; } };
});
