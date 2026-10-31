/* REVA — toolkit core (pure, unit-tested). The utility tools' engines:
   mathEval (real recursive-descent parser — never eval), csvParse
   (quoted-field correct), jsonQuery (path walker), encodeDecode,
   todoScan, wcCalc, uuidGen (injected randomness), unifiedDiff
   (vendored jsdiff when present, honest fallback otherwise).
   Works in the browser (window.TOOLKIT) and node (module.exports). */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TOOLKIT = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : global;

  /* ---- mathEval: safe arithmetic, parsed not eval'd ----
     Grammar: expr := term (('+'|'-') term)* ; term := unary (('*'|'/'|'%') unary)*
     unary := '-' unary | power ; power := atom ('^' unary)?  (right-assoc)
     atom := number | const | func '(' expr (',' expr)* ')' | '(' expr ')' */
  var CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
  var FNS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
    log: function (x) { return Math.log(x); }, log10: Math.log10, log2: Math.log2,
    exp: Math.exp, pow: Math.pow, min: Math.min, max: Math.max,
    sign: Math.sign, cbrt: Math.cbrt, hypot: Math.hypot, random: Math.random
  };
  function mathEval(src) {
    var s = String(src == null ? '' : src).replace(/\s+/g, '');
    var i = 0;
    function peek() { return s[i]; }
    function eat(ch) { if (s[i] === ch) { i++; return true; } return false; }
    function expr() {
      var v = term();
      while (peek() === '+' || peek() === '-') { var op = s[i++]; var r = term(); v = op === '+' ? v + r : v - r; }
      return v;
    }
    function term() {
      var v = unary();
      while (peek() === '*' || peek() === '/' || peek() === '%') {
        var op = s[i++]; var r = unary();
        v = op === '*' ? v * r : op === '/' ? v / r : v % r;
      }
      return v;
    }
    function unary() {
      if (eat('-')) return -unary();
      if (eat('+')) return unary();
      return power();
    }
    function power() {
      var base = atom();
      if (eat('^')) return Math.pow(base, unary()); // right-assoc
      return base;
    }
    function atom() {
      if (eat('(')) { var v = expr(); if (!eat(')')) throw new Error('missing )'); return v; }
      var m = /^[a-z][a-z0-9]*/i.exec(s.slice(i));
      if (m) {
        var name = m[0]; i += name.length;
        var low = name.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(CONSTS, low)) return CONSTS[low];
        /* own-property only — 'constructor' et al. must not resolve via the prototype */
        var fn = Object.prototype.hasOwnProperty.call(FNS, low) ? FNS[low] : null;
        if (!fn) throw new Error('unknown name: ' + name);
        if (!eat('(')) throw new Error(name + ' needs ()');
        var args = [expr()];
        while (eat(',')) args.push(expr());
        if (!eat(')')) throw new Error('missing ) for ' + name);
        return fn.apply(null, args);
      }
      var num = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(s.slice(i));
      if (!num) throw new Error('unexpected "' + (s[i] || 'end') + '" at ' + i);
      i += num[0].length;
      return parseFloat(num[0]);
    }
    var out = expr();
    if (i < s.length) throw new Error('unexpected trailing "' + s.slice(i) + '"');
    if (typeof out !== 'number' || isNaN(out)) throw new Error('not a finite number');
    return out;
  }

  /* ---- csvParse: RFC-4180-ish — quoted fields, "" escapes, CRLF ---- */
  function csvParse(text, delimiter) {
    var d = String(delimiter || ',')[0];
    var rows = [];
    var row = [], field = '', inQ = false;
    var src = String(text == null ? '' : text);
    for (var i = 0; i < src.length; i++) {
      var c = src[i];
      if (inQ) {
        if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === d) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && src[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return { headers: [], rows: [] };
    var headers = rows[0].map(function (h, j) { return h.trim() || ('col' + (j + 1)); });
    var objects = rows.slice(1).map(function (r) {
      var o = {};
      headers.forEach(function (h, j) { o[h] = r[j] !== undefined ? r[j] : ''; });
      return o;
    });
    return { headers: headers, rows: objects, raw: rows };
  }

  /* ---- jsonQuery: 'users[2].name' over parsed JSON ----
     ops: get (default) | keys | len | type */
  function jsonQuery(data, path, op) {
    var cur = data;
    if (path && path !== '.') {
      String(path).replace(/\[(\d+)\]/g, '.$1').split('.').forEach(function (seg) {
        if (!seg) return;
        if (cur === null || cur === undefined) throw new Error('path ends early at "' + seg + '"');
        cur = cur[seg];
        if (cur === undefined) throw new Error('no "' + seg + '" in path');
      });
    }
    if (!op || op === 'get') return cur;
    if (op === 'keys') return cur && typeof cur === 'object' ? Object.keys(cur) : [];
    if (op === 'len') return cur && typeof cur === 'object' ? (cur.length !== undefined ? cur.length : Object.keys(cur).length) : String(cur).length;
    if (op === 'type') return Array.isArray(cur) ? 'array' : cur === null ? 'null' : typeof cur;
    throw new Error('unknown op: ' + op);
  }

  /* ---- encodeDecode: base64 (unicode-safe) | uri | hex ---- */
  function encodeDecode(op, scheme, text) {
    var s = String(text == null ? '' : text);
    if (scheme === 'uri') return op === 'encode' ? encodeURIComponent(s) : decodeURIComponent(s);
    if (scheme === 'hex') {
      if (op === 'encode') {
        var out = '';
        for (var i = 0; i < s.length; i++) out += s.charCodeAt(i).toString(16).padStart(2, '0');
        return out;
      }
      var bytes = s.match(/.{1,2}/g) || [];
      return bytes.map(function (h) { return String.fromCharCode(parseInt(h, 16)); }).join('');
    }
    /* base64, unicode-safe via code-unit bytes */
    if (op === 'encode') {
      var uni = unescape(encodeURIComponent(s));
      var b = root.btoa || function (x) { return Buffer.from(x, 'binary').toString('base64'); };
      return b(uni);
    }
    var d = root.atob || function (x) { return Buffer.from(x, 'base64').toString('binary'); };
    return decodeURIComponent(escape(d(s)));
  }

  /* ---- todoScan: TODO|FIXME|HACK|XXX|BUG markers across files ---- */
  var MARK = /\b(TODO|FIXME|HACK|XXX|BUG)\b[:\s]/;
  function todoScan(filesObj, maxResults) {
    var out = [];
    Object.keys(filesObj || {}).forEach(function (p) {
      if (/\.(png|jpg|jpeg|gif|webp|glb|gltf|wav|mp3|ico|woff2?)$/i.test(p)) return;
      var lines = String(filesObj[p] || '').split('\n');
      for (var i = 0; i < lines.length; i++) {
        var m = MARK.exec(lines[i]);
        if (m) {
          out.push({ path: p, line: i + 1, tag: m[1], text: lines[i].trim().slice(0, 140) });
          if (out.length >= (maxResults || 80)) return out;
        }
      }
    });
    return out;
  }

  /* ---- wcCalc: lines/words/chars for one file ---- */
  function wcCalc(text) {
    var s = String(text == null ? '' : text);
    var words = s.match(/\S+/g);
    return { lines: s === '' ? 0 : s.split('\n').length, words: words ? words.length : 0, chars: s.length };
  }

  /* ---- uuidGen: randomness injected (crypto in page, crypto.node in tests) ---- */
  function uuidGen(kind, count, rnd) {
    var n = Math.min(50, Math.max(1, count || 1));
    var out = [];
    for (var k = 0; k < n; k++) {
      var b = new Uint8Array(16);
      for (var i = 0; i < 16; i++) b[i] = Math.floor(rnd() * 256);
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      var hex = Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
      if (kind === 'hex') out.push(hex);
      else if (kind === 'pin') out.push(String(100000 + Math.floor(rnd() * 900000)));
      else if (kind === 'nanoid') out.push(hex.slice(0, 21));
      else out.push(hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20));
    }
    return out;
  }

  /* ---- unifiedDiff: vendored jsdiff when present, honest fallback ---- */
  function unifiedDiff(a, b, nameA, nameB) {
    var A = String(a == null ? '' : a), B = String(b == null ? '' : b);
    if (root.Diff && root.Diff.createTwoFilesPatch) {
      try { return root.Diff.createTwoFilesPatch(nameA || 'a', nameB || 'b', A, B, '', '', { context: 3 }); }
      catch (e) { /* fall through to the naive marker */ }
    }
    var la = A.split('\n'), lb = B.split('\n'), out = ['--- ' + (nameA || 'a'), '+++ ' + (nameB || 'b')];
    var n = Math.max(la.length, lb.length), changes = 0;
    for (var i = 0; i < n; i++) {
      if (la[i] !== lb[i]) {
        if (la[i] !== undefined) out.push('- ' + la[i]);
        if (lb[i] !== undefined) out.push('+ ' + lb[i]);
        changes++;
      }
    }
    return out.join('\n') + (changes ? '' : '\n(identical)');
  }

  return {
    mathEval: mathEval,
    csvParse: csvParse,
    jsonQuery: jsonQuery,
    encodeDecode: encodeDecode,
    todoScan: todoScan,
    wcCalc: wcCalc,
    uuidGen: uuidGen,
    unifiedDiff: unifiedDiff,
    FNS: FNS
  };
});
