/* REVA — Test Factory (the 600K map's test engine).
   Generates unit-test SCAFFOLDS for workspace modules: detects the export
   contract statically (UMD object exports, single exports, exports.x =,
   function/class declarations), plans per-export contract cases, and renders
   a runnable node test file in the repo's own idiom. The scaffold is honest
   by design: every generated case asserts the CONTRACT (existence/type) —
   deepening into real behavior cases is the caller's job (edit_file).
   Pure UMD: identical code in node tests and the WebView. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TESTFACTORY = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  function walkBraces(src, openIdx) {
    var depth = 0, end = -1;
    for (var i = openIdx; i < src.length; i++) {
      var ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) return null;
    return src.slice(openIdx + 1, end);
  }

  /* splitTop(body): split on top-level commas, nesting-aware. */
  function splitTop(body) {
    var parts = [], depth = 0, cur = '';
    for (var i = 0; i < body.length; i++) {
      var ch = body[i];
      if (ch === '{' || ch === '[' || ch === '(') depth++;
      if (ch === '}' || ch === ']' || ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
  }

  function dedupe(arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }

  /* detectExports(source): ordered names a module hands to consumers.
     Evidence classes: (1) module.exports = { ... } (keys + shorthand),
     (2) module.exports = Name (single), (3) exports.x =, (4) fallback:
     top-level function/class declarations. */
  function detectExports(source) {
    var src = String(source || '');
    var out = [];
    var m = src.match(/module\.exports\s*=\s*\{/);
    if (m) {
      var open = src.indexOf('{', m.index);
      var body = walkBraces(src, open);
      if (body !== null) {
        splitTop(body).forEach(function (part) {
          var kv = part.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
          if (kv) out.push(kv[1]);
          else {
            var sh = part.match(/^\s*([A-Za-z_$][\w$]*)\s*$/);
            if (sh) out.push(sh[1]);
          }
        });
      }
      if (out.length) return dedupe(out);
    }
    var single = src.match(/module\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;?/);
    if (single) return [single[1]];
    var exs = [];
    (src.match(/(?:^|[^\w.])exports\.([A-Za-z_$][\w$]*)\s*=/g) || []).forEach(function (s) {
      var nm = s.match(/exports\.([A-Za-z_$][\w$]*)/);
      if (nm) exs.push(nm[1]);
    });
    if (exs.length) return dedupe(exs);
    var fns = src.match(/(?:^|[^\w$])(?:async )?function\s+([A-Za-z_$][\w$]*)/g) || [];
    fns.forEach(function (s) {
      var nm = s.match(/function\s+([A-Za-z_$][\w$]*)/);
      if (nm) out.push(nm[1]);
    });
    (src.match(/(?:^|[^\w$])class\s+([A-Za-z_$][\w$]*)/g) || []).forEach(function (s) {
      var nm = s.match(/class\s+([A-Za-z_$][\w$]*)/);
      if (nm) out.push(nm[1]);
    });
    return dedupe(out);
  }

  /* detectMethods(source, className): prototype method names for a class.
     Anchors on 'class <Name> {' and reads two-space-indented method lines
     from the class body. Static-analysis limit: mentions inside strings may
     false-positive — acceptable for scaffold planning. */
  function detectMethods(source, className) {
    var src = String(source || '');
    var anchor = src.indexOf('class ' + className);
    if (anchor < 0) return [];
    var open = src.indexOf('{', anchor);
    var body = walkBraces(src, open);
    if (body === null) return [];
    var names = [];
    (body.match(/(?:^|\n)  (?:async )?([A-Za-z_$][\w$]*)\s*\(/g) || []).forEach(function (s) {
      var nm = s.match(/(?:async )?([A-Za-z_$][\w$]*)\s*\(/);
      if (nm && SKIP.indexOf(nm[1]) < 0) names.push(nm[1]);
    });
    return dedupe(names);
  }
  var SKIP = ['constructor', 'get', 'set', 'static', 'if', 'for', 'while', 'switch', 'catch'];

  /* protoMethods(source): every X.prototype.m assignment, as a map.
     Covers the constructor-function pattern REVA's UMD files use
     (function Name(){} + Name.prototype.m = ...) alongside class bodies. */
  function protoMethods(source) {
    var src = String(source || '');
    var map = {};
    (src.match(/([A-Za-z_$][\w$]*)\.prototype\.([A-Za-z_$][\w$]*)\s*=/g) || []).forEach(function (s) {
      var nm = s.match(/([A-Za-z_$][\w$]*)\.prototype\.([A-Za-z_$][\w$]*)/);
      if (!nm || SKIP.indexOf(nm[2]) >= 0) return;
      if (!map[nm[1]]) map[nm[1]] = [];
      map[nm[1]].push(nm[2]);
    });
    Object.keys(map).forEach(function (k) { map[k] = dedupe(map[k]); });
    return map;
  }

  /* planTests(source): the ordered plan the renderer walks.
     kind: 'object' (UMD export map) | 'single' | 'named' | 'class' | 'proto'. */
  function planTests(source) {
    var src = String(source || '');
    var plan = [];
    var proto = protoMethods(src);
    var objRe = /module\.exports\s*=\s*\{/;
    var singleRe = src.match(/module\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;?/);
    if (objRe.test(src)) {
      detectExports(src).forEach(function (name) {
        var item = { name: name, kind: 'object' };
        if (proto[name]) { item.kind = 'proto'; item.methods = proto[name]; }
        plan.push(item);
      });
      return plan;
    }
    if (singleRe) {
      var name = singleRe[1];
      var item = { name: name, kind: 'single' };
      if (proto[name]) { item.kind = 'proto'; item.methods = proto[name]; }
      else if (src.indexOf('class ' + name) >= 0) { item.kind = 'class'; item.methods = detectMethods(src, name); }
      plan.push(item);
      return plan;
    }
    detectExports(src).forEach(function (name) {
      var item = { name: name, kind: 'named' };
      if (proto[name]) { item.kind = 'proto'; item.methods = proto[name]; }
      else if (src.indexOf('class ' + name) >= 0) { item.kind = 'class'; item.methods = detectMethods(src, name); }
      plan.push(item);
    });
    return plan;
  }

  /* renderSuite(plan, opts): a runnable node test file in the repo idiom.
     opts.relPath (module path from the repo root, used for the require),
     opts.label (PASS-line prefix; default = basename). */
  function renderSuite(plan, opts) {
    opts = opts || {};
    var relPath = String(opts.relPath || 'js/module.js');
    var label = opts.label || relPath.split('/').pop().replace(/\.js$/, '');
    var reqPath = relPath.indexOf('../') === 0 ? relPath : '../' + relPath.replace(/^\.\//, '');
    var L = [];
    var checks = 0;
    L.push('/* Test scaffold by the REVA test factory — contract checks for ' + relPath + '.');
    L.push('   Each case asserts the export CONTRACT (existence/type). Deepen into real');
    L.push('   behavior cases (edit_file) — a scaffold is structure, not proof. */');
    L.push("'use strict';");
    L.push("const assert = require('assert');");
    L.push("const M = require('" + reqPath + "');");
    L.push('');
    L.push('(async () => {');
    /* single/proto/class: module.exports IS the export (M itself).
       object: M is the export map (check its keys). named: module-internal
       decls with no export evidence — a TODO note, never a fake pass. */
    plan.forEach(function (item, idx) {
      var n = idx + 1;
      if (item.kind === 'proto') {
        L.push('  // ' + n + '. contract: the module exports a constructor with prototype methods');
        L.push("  assert.strictEqual(typeof M, 'function', 'module exports the " + item.name + " constructor');");
        checks++;
        (item.methods || []).forEach(function (meth) {
          L.push("  assert.strictEqual(typeof M.prototype." + meth + ", 'function', '" + item.name + "#" + meth + " exists');");
          checks++;
        });
      } else if (item.kind === 'class') {
        L.push('  // ' + n + '. contract: the module exports a class with methods');
        L.push("  assert.strictEqual(typeof M, 'function', 'module exports the " + item.name + " class');");
        checks++;
        (item.methods || []).forEach(function (meth) {
          L.push("  assert.strictEqual(typeof M.prototype." + meth + ", 'function', '" + item.name + "#" + meth + " exists');");
          checks++;
        });
      } else if (item.kind === 'single') {
        L.push('  // ' + n + '. contract: the module exports ' + item.name + ' (opaque single)');
        L.push("  assert.ok(M, 'module exports " + item.name + "');");
        checks++;
      } else if (item.kind === 'named') {
        L.push('  // ' + n + '. ' + item.name + ' is a module-internal declaration (no export evidence).');
        L.push('  // TODO: export it or deepen this scaffold by hand.');
      } else {
        L.push('  // ' + n + '. contract: ' + item.name + ' exists on the export map');
        L.push("  assert.ok(Object.prototype.hasOwnProperty.call(M, '" + item.name + "'), '" + item.name + " exported');");
        checks++;
      }
    });
    L.push('');
    L.push("  console.log('" + label + ": scaffold PASS (" + checks + " contract checks)');");
    L.push('  process.exit(0);');
    L.push("})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });");
    return L.join('\n') + '\n';
  }

  return {
    walkBraces: walkBraces,
    splitTop: splitTop,
    dedupe: dedupe,
    detectExports: detectExports,
    detectMethods: detectMethods,
    protoMethods: protoMethods,
    planTests: planTests,
    renderSuite: renderSuite
  };
});
