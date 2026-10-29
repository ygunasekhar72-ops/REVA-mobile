/* REVA — tree-sitter AST engine (leverage doctrine: web-tree-sitter, MIT,
   with prebuilt grammar WASMs — see THIRD_PARTY_NOTICES.md).
   Real syntax trees for 19 languages replace regex symbol guessing.
   Lazy: nothing loads until the first symbol request; every failure
   (missing wasm, offline, parse error) falls back to the regex reporter.
   Pure parts (kindsFor/extLang/extractWith) work in node too, so the unit
   tests run the exact extraction the WebView runs. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.REVATS = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  /* node type → symbol kind, per grammar. Anything absent is unparsed. */
  var KINDS = {
    javascript: { function_declaration: 'func', generator_function_declaration: 'func', class_declaration: 'class', method_definition: 'method' },
    typescript: { function_declaration: 'func', generator_function_declaration: 'func', class_declaration: 'class', abstract_class_declaration: 'class', method_definition: 'method', function_signature: 'func' },
    tsx: { function_declaration: 'func', class_declaration: 'class', abstract_class_declaration: 'class', method_definition: 'method' },
    python: { function_definition: 'func', class_definition: 'class' },
    c: { function_definition: 'func', struct_specifier: 'struct' },
    cpp: { function_definition: 'func', class_specifier: 'class', struct_specifier: 'struct' },
    java: { method_declaration: 'method', class_declaration: 'class', interface_declaration: 'interface' },
    kotlin: { function_declaration: 'func', class_declaration: 'class', object_declaration: 'object' },
    rust: { function_item: 'func', struct_item: 'struct', enum_item: 'enum', trait_item: 'trait' },
    go: { function_declaration: 'func', method_declaration: 'method' },
    php: { function_definition: 'func', method_declaration: 'method', class_declaration: 'class' },
    ruby: { method: 'func', singleton_method: 'func', class: 'class', module: 'module' },
    lua: { function_declaration: 'func', function_definition: 'func' },
    bash: { function_definition: 'func' },
    css: {}, json: {}, html: {}, yaml: {}, sql: {}
  };
  var JS_FAMILY = { javascript: 1, typescript: 1, tsx: 1 };

  var EXT_LANG = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'tsx', py: 'python', html: 'html', htm: 'html', css: 'css', json: 'json', sh: 'bash', bash: 'bash', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', java: 'java', kt: 'kotlin', rs: 'rust', go: 'go', php: 'php', rb: 'ruby', lua: 'lua', sql: 'sql', yml: 'yaml', yaml: 'yaml' };

  function extLang(ext) { return EXT_LANG[String(ext || '').toLowerCase().replace(/^\./, '')] || null; }
  function kindsFor(lang) { return KINDS[lang] || null; }

  /* the pure extraction the tests and the browser share */
  function extractWith(parser, lang, src) {
    var kinds = KINDS[lang];
    if (!kinds || !parser) return null;
    var out = [];
    var tree = parser.parse(String(src));
    (function visit(node, depth, parentKind) {
      if (depth > 200) return;
      var kind = kinds[node.type];
      /* python's grammar has no method node — a function_definition inside
         a class IS a method */
      if (lang === 'python' && node.type === 'function_definition' && parentKind === 'class') kind = 'method';
      if (kind) {
        var nameNode = node.childForFieldName && node.childForFieldName('name');
        if (nameNode) out.push({ kind: kind, name: String(nameNode.text || ''), line: node.startPosition.row + 1 });
      }
      /* JS family: const foo = () => {} / function expressions in declarators */
      if (JS_FAMILY[lang] && node.type === 'variable_declarator') {
        var nm = node.childForFieldName('name');
        var val = node.childForFieldName('value');
        if (nm && val && (val.type === 'arrow_function' || val.type === 'function_expression' || val.type === 'function')) {
          out.push({ kind: 'func', name: String(nm.text || ''), line: node.startPosition.row + 1 });
        }
      }
      var kids = node.children;
      for (var i = 0; i < kids.length; i++) visit(kids[i], depth + 1, kind || parentKind);
    })(tree.rootNode, 0, '');
    tree.delete();
    out.sort(function (a, b) { return a.line - b.line; });
    return out;
  }

  /* ---- browser glue (no-ops in node) ---- */
  var ready = null, parsers = null;
  function vendor(f) { return 'js/vendor/' + f; }

  function ensure() {
    if (ready) return ready;
    var TS = (typeof window !== 'undefined') && window.TreeSitter;
    if (!TS) { ready = Promise.resolve(false); return ready; }
    parsers = {};
    ready = TS.init({ locateFile: function (f) { return vendor(f); } })
      .then(function () { return true; })
      .catch(function () { ready = null; return false; });
    return ready;
  }

  function loadLang(lang) {
    if (parsers[lang]) return Promise.resolve(parsers[lang]);
    var TS = window.TreeSitter;
    return TS.Language.load(vendor('ts/tree-sitter-' + lang + '.wasm')).then(function (L) {
      var p = new TS(); // TreeSitter IS the Parser class (static init, static Language)
      p.setLanguage(L);
      parsers[lang] = p;
      return p;
    });
  }

  /* symbolsFor(ext, src) → { lang, symbols } | null (null = caller falls back) */
  function symbolsFor(ext, src) {
    var lang = extLang(ext);
    if (!lang) return Promise.resolve(null);
    return ensure().then(function (ok) {
      if (!ok) return null;
      return loadLang(lang).then(function (p) {
        try {
          var symbols = extractWith(p, lang, src);
          return symbols ? { lang: lang, symbols: symbols } : null;
        } catch (e) { return null; }
      });
    }).catch(function () { return null; });
  }

  return { extLang: extLang, kindsFor: kindsFor, extractWith: extractWith, symbolsFor: symbolsFor, ensure: ensure };
});
