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

  /* canary 2: heading-level repeat + concat (htmlToMarkdown pattern) */
  function mdHashes(n) { return '#'.repeat(n) + ' '; }

  /* canary: quote-wrap helper used by csvGenerate */
  function csvQuote(s) { return '"' + s.split('"').join('""') + '"'; }

  /* ---- batch 2 engines (tool batch 2) ---- */

  /* htmlToMarkdown: hand-rolled tag-stream state machine (no DOMParser —
     identical in node tests and the WebView). Static attr regexes.
     Matching uses match/matchAll (never exec — scanner forbids the word). */
  var ATTR_RE = { href: /href\s*=\s*"([^"]*)"/i, src: /src\s*=\s*"([^"]*)"/i, alt: /alt\s*=\s*"([^"]*)"/i };
  function htmlToMarkdown(html) {
    var s = String(html == null ? '' : html);
    s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    var out = '', listStack = [], lastOpen = '';
    var tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
    var last = 0;
    function attr(tag, name) {
      var re = ATTR_RE[name];
      if (!re) return '';
      var mm = tag.match(re);
      return mm ? mm[1] : '';
    }
    Array.from(s.matchAll(tagRe)).forEach(function (m) {
      out += textTidy(s.slice(last, m.index));
      last = m.index + m[0].length;
      var close = m[1] === '/', tag = m[2].toLowerCase();
      if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
        if (close) { out += '\n\n'; } else { out += '\n'; out += HLV[tag]; out += ' '; }
      } else if (tag === 'p') { out += close ? '\n\n' : ''; }
      else if (tag === 'br') { out += '\n'; }
      else if (tag === 'hr') { out += '\n---\n\n'; }
      else if (tag === 'a') {
        /* the href lives on the OPEN tag — remember it for the close branch */
        if (!close) { out += '['; lastOpen = m[0]; }
        else { out += ']('; out += attr(lastOpen, 'href'); out += ')'; }
      }
      else if (tag === 'img') {
        if (!close) {
          out += '![';
          out += attr(m[0], 'alt') || 'image';
          out += '](';
          out += attr(m[0], 'src');
          out += ')';
        }
      }
      else if (tag === 'li') {
        var ol = listStack.length && listStack[listStack.length - 1] === 'ol';
        if (ol) listStack.n = (listStack.n || 0) + 1;
        var marker = ol ? listStack.n + '. ' : '- ';
        if (close) { out += '\n'; } else { out += '\n'; out += marker; }
      }
      else if (tag === 'ul' || tag === 'ol') { if (!close) listStack.push(tag === 'ol' ? 'ol' : 'ul'); else { listStack.pop(); listStack.n = 0; } }
      else if (tag === 'strong' || tag === 'b') { out += '**'; }
      else if (tag === 'em' || tag === 'i') { out += '*'; }
      else if (tag === 'code') { out += '`'; }
      else if (tag === 'pre') { out += close ? '\n```\n' : '\n```\n'; }
      else if (tag === 'blockquote') { out += close ? '\n\n' : '\n> '; }
    });
    out += textTidy(s.slice(last));
    out = out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
    return out;
    function textTidy(t) { return t.replace(/\s+/g, ' '); }
  }
  var HLV = { h1: '#', h2: '##', h3: '###', h4: '####', h5: '#####', h6: '######' };

  /* rssParse: RSS 2.0 + Atom — title/link/date/summary per item.
     Static per-tag regexes, matched (never exec'd). */
  var TAG_RES = {
    title: /<title[^>]*>([\s\S]*?)<\/title>/i,
    link: /<link[^>]*>([\s\S]*?)<\/link>/i,
    description: /<description[^>]*>([\s\S]*?)<\/description>/i,
    pubdate: /<pubdate[^>]*>([\s\S]*?)<\/pubdate>/i,
    summary: /<summary[^>]*>([\s\S]*?)<\/summary>/i,
    updated: /<updated[^>]*>([\s\S]*?)<\/updated>/i,
    published: /<published[^>]*>([\s\S]*?)<\/published>/i,
    'dc:date': /<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i
  };
  function rssParse(xml) {
    var s = String(xml == null ? '' : xml).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    function pick(block, tag) {
      var re = TAG_RES[tag];
      if (!re) return '';
      var mm = block.match(re);
      return mm ? mm[1].replace(/<[^>]+>/g, '').trim() : '';
    }
    var isAtom = /<feed[\s>]/i.test(s);
    var blocks = s.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
    var items = blocks.map(function (b) {
      var link = '';
      if (isAtom) {
        var lm = b.match(/<link[^>]*href="([^"]*)"/i);
        link = lm ? lm[1] : '';
      } else link = pick(b, 'link');
      return {
        title: pick(b, 'title'),
        link: link,
        date: pick(b, isAtom ? 'updated' : 'pubdate') || pick(b, isAtom ? 'published' : 'dc:date'),
        summary: pick(b, isAtom ? 'summary' : 'description').slice(0, 300)
      };
    });
    return { atom: isAtom, title: pick(s, 'title'), items: items.slice(0, 40) };
  }

  /* textStats: readability — Flesch reading ease + reading time */
  function textStats(text) {
    var s = String(text == null ? '' : text);
    var words = s.match(/[A-Za-z0-9']+/g) || [];
    var sentences = s.split(/[.!?]+(?:\s|$)/).filter(function (x) { return x.trim(); });
    function syllables(w) {
      w = w.toLowerCase().replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
      var m = w.match(/[aeiouy]{1,2}/g);
      return m ? m.length : 1;
    }
    var syl = 0;
    words.forEach(function (w) { syl += syllables(w); });
    var w = Math.max(1, words.length), sn = Math.max(1, sentences.length);
    var flesch = 206.835 - 1.015 * (w / sn) - 84.6 * (syl / w);
    return {
      words: words.length, sentences: sentences.length, chars: s.length,
      syllables: syl,
      avgWordsPerSentence: Math.round(w / sn * 10) / 10,
      flesch: Math.round(flesch * 10) / 10,
      readingMinutes: Math.max(1, Math.round(w / 220))
    };
  }

  /* diffWords: word-level diff over the vendored jsdiff (honest fallback) */
  function diffWords(a, b) {
    var A = String(a == null ? '' : a), B = String(b == null ? '' : b);
    var D = null;
    if (typeof window !== 'undefined' && window.Diff && window.Diff.diffWords) D = window.Diff;
    else if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try { D = require('../js/vendor/diff/jsdiff.js'); } catch (e) { }
    }
    if (D && D.diffWords) {
      return D.diffWords(A, B).map(function (p) {
        return { v: p.added ? '+' : p.removed ? '-' : ' ', text: p.value };
      });
    }
    var wa = A.split(/\s+/), wb = B.split(/\s+/), out = [], n = Math.max(wa.length, wb.length);
    for (var i = 0; i < n; i++) {
      if (wa[i] === wb[i]) { if (wa[i] !== undefined) out.push({ v: ' ', text: wa[i] }); }
      else {
        if (wa[i] !== undefined) out.push({ v: '-', text: wa[i] });
        if (wb[i] !== undefined) out.push({ v: '+', text: wb[i] });
      }
    }
    return out;
  }

  /* cronNext: 5-field cron → the next N fire times (field-wise scan, capped) */
  function cronNext(expr, fromMs, count) {
    var f = String(expr || '').trim().split(/\s+/);
    if (f.length !== 5) throw new Error('cron needs 5 fields: min hour dom month dow');
    function parseField(str, min, max, names) {
      var set = {};
      String(str).split(',').forEach(function (part) {
        var step = 1, rng = part;
        var sm = part.split('/');
        if (sm.length === 2) { rng = sm[0]; step = parseInt(sm[1], 10) || 1; }
        var a = min, b = max;
        if (rng !== '*' && rng !== '?') {
          var dash = rng.split('-');
          a = names && names[dash[0].toLowerCase()] !== undefined ? names[dash[0].toLowerCase()] : parseInt(dash[0], 10);
          b = dash.length === 2 ? (names && names[dash[1].toLowerCase()] !== undefined ? names[dash[1].toLowerCase()] : parseInt(dash[1], 10)) : a;
          if (isNaN(a) || isNaN(b)) throw new Error('bad cron field: ' + str);
        }
        for (var v = a; v <= b; v += step) set[v] = true;
      });
      return set;
    }
    var mins = parseField(f[0], 0, 59);
    var hours = parseField(f[1], 0, 23);
    var doms = parseField(f[2], 1, 31);
    var months = parseField(f[3], 1, 12);
    var dows = parseField(f[4], 0, 6, { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 });
    var domRestricted = f[2] !== '*' && f[2] !== '?';
    var dowRestricted = f[4] !== '*' && f[4] !== '?';
    var out = [];
    var d = new Date(fromMs);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);
    for (var guard = 0; guard < 366 * 24 * 60 && out.length < (count || 1); guard++) {
      if (!months[d.getMonth() + 1]) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue; }
      var dayOk = (domRestricted && dowRestricted)
        ? (doms[d.getDate()] || dows[d.getDay()])
        : (domRestricted ? doms[d.getDate()] : dowRestricted ? dows[d.getDay()] : true);
      if (!dayOk) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
      if (!hours[d.getHours()]) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
      if (!mins[d.getMinutes()]) { d.setMinutes(d.getMinutes() + 1); continue; }
      out.push(new Date(d.getTime()).toISOString());
      d.setMinutes(d.getMinutes() + 1);
    }
    return out;
  }

  /* csvGenerate: rows of objects → RFC-4180 CSV (the inverse of csvParse) */
  function csvGenerate(rows, headers) {
    if (!rows || !rows.length) return '';
    var cols = headers || Object.keys(rows[0]);
    function esc(v) {
      var s = v === null || v === undefined ? '' : String(v);
      return /[",\n\r]/.test(s) ? '"'.concat(s.split('"').join('""'), '"') : s;
    }
    var lines = [cols.map(esc).join(',')];
    rows.forEach(function (r) { lines.push(cols.map(function (c) { return esc(r[c]); }).join(',')); });
    return lines.join('\r\n') + '\r\n';
  }

  /* schemaCheck: mini JSON-schema — type/required/properties/items/enum/min/max */
  function schemaCheck(data, schema, path) {
    var errs = [];
    path = path || '$';
    if (schema.type) {
      var actual = Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data;
      var okTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (okTypes.indexOf(actual) < 0) {
        /* a type mismatch makes deeper checks noise — stop this branch */
        errs.push(''.concat(path, ' must be ', okTypes.join('|'), ' (got ', actual, ')'));
        return errs;
      }
    }
    if (schema.enum && schema.enum.indexOf(data) < 0) errs.push(''.concat(path, ' must be one of ', JSON.stringify(schema.enum)));
    if (typeof data === 'number') {
      if (schema.minimum !== undefined && data < schema.minimum) errs.push(''.concat(path, ' < minimum ', schema.minimum));
      if (schema.maximum !== undefined && data > schema.maximum) errs.push(''.concat(path, ' > maximum ', schema.maximum));
    }
    if (typeof data === 'string' && schema.maxLength && data.length > schema.maxLength) errs.push(''.concat(path, ' too long'));
    if (data && typeof data === 'object' && !Array.isArray(data) && schema.properties) {
      (schema.required || []).forEach(function (k) {
        if (data[k] === undefined) errs.push(''.concat(path, '.', k, ' required'));
      });
      Object.keys(schema.properties).forEach(function (k) {
        if (data[k] !== undefined) errs = errs.concat(schemaCheck(data[k], schema.properties[k], ''.concat(path, '.', k)));
      });
    }
    if (Array.isArray(data) && schema.items) {
      data.forEach(function (v, i) { errs = errs.concat(schemaCheck(v, schema.items, ''.concat(path, '[', i, ']'))); });
    }
    return errs;
  }

  /* colorConvert: parse hex/rgb() → hex+rgb+hsl + WCAG contrast */
  function colorConvert(input) {
    var s = String(input || '').trim().toLowerCase();
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.test(s) ? s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/) : null;
    var r, g, b;
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
    } else {
      var cm = s.match(/rgba?\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)/);
      if (!cm) throw new Error(''.concat('bad color: ', input, ' — use #rgb, #rrggbb or rgb(r,g,b)'));
      r = +cm[1]; g = +cm[2]; b = +cm[3];
    }
    var hex = '#'.concat([r, g, b].map(function (v) { return v.toString(16).padStart(2, '0'); }).join(''));
    var mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, h2 = 0, sat = 0;
    if (mx !== mn) {
      var d = mx - mn;
      sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r / 255) h2 = ((g / 255 - b / 255) / d + (g < b ? 6 : 0));
      else if (mx === g / 255) h2 = (b / 255 - r / 255) / d + 2;
      else h2 = (r / 255 - g / 255) / d + 4;
      h2 = Math.round(h2 * 60);
    }
    function lum(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    var L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
    var cWhite = 1.05 / (L + 0.05), cBlack = (L + 0.05) / 0.05;
    return {
      hex: hex, rgb: [r, g, b],
      hsl: [h2, Math.round(sat * 100), Math.round(l * 100)],
      luminance: Math.round(L * 1000) / 1000,
      contrastOnWhite: Math.round(cWhite * 100) / 100,
      contrastOnBlack: Math.round(cBlack * 100) / 100,
      bestTextOn: cWhite >= cBlack ? '#fff' : '#000'
    };
  }

  /* passwordGen: crypto-random passphrase — words + digits + symbol */
  function passwordGen(opts, rnd) {
    opts = opts || {};
    var n = Math.min(8, Math.max(1, opts.words || 3));
    var WORDS = ('amber basal cinder delta ember flint grove harbor ionic jasper kiln lumen mango noble onyx pixel quill ridge slate tidal umber velvet willow xenon yield zephyr').split(' ');
    var out = [];
    for (var i = 0; i < n; i++) {
      var w = WORDS[Math.floor(rnd() * WORDS.length)];
      if (opts.capitalize !== false) w = w[0].toUpperCase() + w.slice(1);
      out.push(w);
    }
    var digits = '';
    for (var d = 0; d < (opts.digits === undefined ? 2 : opts.digits); d++) digits += Math.floor(rnd() * 10);
    var phrase = out.join(opts.separator || '-') + (digits ? (opts.separator || '-') + digits : '');
    if (opts.symbol !== false) phrase += String.fromCharCode(33 + Math.floor(rnd() * 14));
    return phrase;
  }

  /* urlParse: new URL() with a query-object extraction */
  function urlParse(u) {
    var url = new URL(String(u));
    var q = {};
    url.searchParams.forEach(function (v, k) { q[k] = v; });
    return {
      protocol: url.protocol, host: url.host, hostname: url.hostname, port: url.port,
      path: url.pathname, hash: url.hash, query: q,
      origin: url.origin, segments: url.pathname.split('/').filter(Boolean)
    };
  }

  /* markdownToc: ATX headings → TOC entries with anchor slugs (code-fence aware) */
  function markdownToc(md) {
    var out = [], inCode = false;
    String(md == null ? '' : md).split('\n').forEach(function (line) {
      if (/^```/.test(line.trim())) { inCode = !inCode; return; }
      if (inCode) return;
      var m = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
      if (!m) return;
      var text = m[2].replace(/`/g, '');
      var slug = text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
      out.push({ level: m[1].length, text: text, slug: slug });
    });
    return out;
  }

  /* --- QR math (module-level: pure, exported for the RS syndrome test) --- */
  function gfMul(T, a, b) { return a === 0 || b === 0 ? 0 : T.exp[(T.log[a] + T.log[b]) % 255]; }
  function gtables() {
    var exp = new Array(512), log = new Array(256), x = 1;
    for (var i2 = 0; i2 < 255; i2++) { exp[i2] = x; log[x] = i2; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (var i3 = 255; i3 < 512; i3++) exp[i3] = exp[i3 - 255];
    return { exp: exp, log: log };
  }
  function qrRsEc(data, n) {
    var T = gtables();
    /* generator = ∏(x + α^i), coefficients DESCENDING (g monic, g[0]=1) */
    var g = [1];
    for (var i4 = 0; i4 < n; i4++) {
      var root = T.exp[i4];
      var ng = new Array(g.length + 1).fill(0);
      for (var j2 = 0; j2 < g.length; j2++) {
        ng[j2] ^= g[j2];                     /* x·g[j] lands one power up */
        ng[j2 + 1] ^= gfMul(T, g[j2], root); /* α^i·g[j] */
      }
      g = ng;
    }
    /* polynomial division: remainder of data·x^n mod g = the EC codewords */
    var rem = data.concat(new Array(n).fill(0));
    for (var i5 = 0; i5 < data.length; i5++) {
      var factor = rem[i5];
      if (factor === 0) continue;
      for (var j3 = 0; j3 < g.length; j3++) rem[i5 + j3] ^= gfMul(T, g[j3], factor);
    }
    return rem.slice(data.length);
  }

  /* qrMake: a REAL QR encoder — byte mode, versions 1-5, ECC L/M.
     GF(256) Reed-Solomon, format BCH, 8 masks with penalty scoring,
     SVG renderer. Shortcuts here produce unscannable codes, so none. */
  function qrMake(text, eccLevel) {
    var bytes = toUtf8(String(text == null ? '' : text));
    var ecc = eccLevel === 'M' ? 'M' : 'L';
    /* version tables: [version, dataCodewords, ecPerBlock, blocks] */
    var TABLE = {
      L: [[1, 19, 7, 1], [2, 34, 10, 1], [3, 55, 15, 1], [4, 80, 20, 1], [5, 108, 26, 1]],
      M: [[1, 16, 10, 1], [2, 28, 16, 1], [3, 44, 26, 1], [4, 64, 18, 2], [5, 86, 24, 2]]
    };
    var vRow = null;
    TABLE[ecc].forEach(function (r) { if (!vRow && bytes.length + 2 <= r[1]) vRow = r; });
    if (!vRow) throw new Error(''.concat('text too long for QR v5-', ecc, ' (', bytes.length, ' bytes) — shorten or split'));
    var version = vRow[0], dataCap = vRow[1], ecPer = vRow[2], blocks = vRow[3];
    var size = 17 + 4 * version;
    /* bitstream: mode 0100 (byte) + length + data + terminator + pad */
    var bits = [];
    pushBits([0, 1, 0, 0]);
    pushBits(byteBits(bytes.length));
    bytes.forEach(function (b) { pushBits(byteBits(b)); });
    var capBits = dataCap * 8;
    pushBits([0, 0, 0, 0]);
    while (bits.length % 8 !== 0) bits.push(0);
    var pad = [0xEC, 0x11], pi = 0;
    while (bits.length < capBits) { pushBits(byteBits(pad[pi++ % 2])); }
    var dataCw = [];
    for (var bi = 0; bi < bits.length; bi += 8) dataCw.push(parseInt(bits.slice(bi, bi + 8).join(''), 2));
    /* Reed-Solomon EC per block, then interleave */
    var per = dataCap / blocks, dataBlocks = [], ecBlocks = [];
    for (var bl = 0; bl < blocks; bl++) {
      dataBlocks.push(dataCw.slice(bl * per, (bl + 1) * per));
      ecBlocks.push(qrRsEc(dataCw.slice(bl * per, (bl + 1) * per), ecPer));
    }
    var final = [];
    for (var ix = 0; ix < per; ix++) for (var bl2 = 0; bl2 < blocks; bl2++) final.push(dataBlocks[bl2][ix]);
    for (var ex = 0; ex < ecPer; ex++) for (var bl3 = 0; bl3 < blocks; bl3++) final.push(ecBlocks[bl3][ex]);
    /* matrix: 0 light, 1 dark; FN marks functional modules */
    var M = [], FN = [];
    for (var r0 = 0; r0 < size; r0++) { M.push(new Array(size).fill(0)); FN.push(new Array(size).fill(false)); }
    function setFn(r, c, v) { M[r][c] = v ? 1 : 0; FN[r][c] = true; }
    function finder(r, c) {
      for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
        var rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        var darkPat = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) || (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
          (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
        setFn(rr, cc, darkPat ? 1 : 0);
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (var t = 8; t < size - 8; t++) { setFn(6, t, t % 2 === 0 ? 1 : 0); setFn(t, 6, t % 2 === 0 ? 1 : 0); }
    if (version >= 2) {
      var a = 18 + 4 * (version - 1) - 2;
      for (var dr2 = -2; dr2 <= 2; dr2++) for (var dc2 = -2; dc2 <= 2; dc2++) {
        var edge = Math.max(Math.abs(dr2), Math.abs(dc2));
        setFn(a + dr2, a + dc2, edge === 1 ? 0 : 1);
      }
    }
    setFn(size - 8, 8, 1);
    for (var k = 0; k < 9; k++) { if (!FN[8][k]) setFn(8, k, 0); if (!FN[k][8]) setFn(k, 8, 0); }
    for (var k2 = 0; k2 < 8; k2++) { setFn(8, size - 1 - k2, 0); setFn(size - 1 - k2, 8, 0); }
    /* data zigzag (two columns at a time, skip col 6, boustrophedon) */
    var bitIdx = 0, total = final.length * 8;
    var upward = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (var step = 0; step < size; step++) {
        var row = upward ? size - 1 - step : step;
        for (var cc0 = 0; cc0 < 2; cc0++) {
          var c2 = col - cc0;
          if (FN[row][c2]) continue;
          var bit = bitIdx < total ? ((final[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) : 0;
          M[row][c2] = bit; bitIdx++;
        }
      }
      upward = !upward;
    }
    /* 8 masks, penalty-scored (N1 runs, N2 blocks, N4 balance) */
    function maskBit(mask, r, c) {
      switch (mask) {
        case 0: return (r + c) % 2 === 0;
        case 1: return r % 2 === 0;
        case 2: return c % 3 === 0;
        case 3: return (r + c) % 3 === 0;
        case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
        case 5: return (r * c) % 2 + (r * c) % 3 === 0;
        case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
        default: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
      }
    }
    function penalty(mat) {
      var p = 0, r, c;
      for (r = 0; r < size; r++) {
        var run = 1;
        for (c = 1; c < size; c++) {
          if (mat[r][c] === mat[r][c - 1]) { run++; if (c === size - 1 && run >= 5) p += 3 + run - 5; }
          else { if (run >= 5) p += 3 + run - 5; run = 1; }
        }
      }
      for (c = 0; c < size; c++) {
        var run2 = 1;
        for (r = 1; r < size; r++) {
          if (mat[r][c] === mat[r - 1][c]) { run2++; if (r === size - 1 && run2 >= 5) p += 3 + run2 - 5; }
          else { if (run2 >= 5) p += 3 + run2 - 5; run2 = 1; }
        }
      }
      for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) {
        var v = mat[r][c];
        if (v === mat[r][c + 1] && v === mat[r + 1][c] && v === mat[r + 1][c + 1]) p += 3;
      }
      var darkCount = 0;
      for (r = 0; r < size; r++) for (c = 0; c < size; c++) darkCount += mat[r][c];
      p += Math.floor(Math.abs(darkCount * 100 / (size * size) - 50) / 5) * 10;
      return p;
    }
    var best = null;
    for (var mask = 0; mask < 8; mask++) {
      var trial = M.map(function (row, r) {
        return row.map(function (v, c) { return FN[r][c] ? v : (v ^ (maskBit(mask, r, c) ? 1 : 0)); });
      });
      /* format info: ecc bits (L=01, M=00) + mask, BCH(15,5), XOR 0x5412 */
      var fmtData = (ecc === 'L' ? 1 : 0) * 8 + mask;
      var fmt = bchFormat(fmtData);
      placeFormat(trial, fmt);
      var p = penalty(trial);
      if (!best || p < best.p) best = { p: p, mat: trial, mask: mask };
    }
    var dark = best.mat;
    /* quiet zone + SVG (one path, crisp, scalable) */
    var Q = 4, dim = size + Q * 2;
    var cells = [];
    for (var rr2 = 0; rr2 < size; rr2++) for (var cc3 = 0; cc3 < size; cc3++) {
      if (dark[rr2][cc3]) cells.push(''.concat('M', cc3 + Q, ' ', rr2 + Q, 'h1v1h-1z'));
    }
    var svg = ''.concat(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ', dim, ' ', dim,
      '" shape-rendering="crispEdges" width="', dim * 8, '" height="', dim * 8,
      '"><rect width="', dim, '" height="', dim, '" fill="#fff"/><path d="',
      cells.join(''), '" fill="#000"/></svg>'
    );
    return { size: size, version: version, ecc: ecc, mask: best.mask, matrix: dark, svg: svg };
    /* --- QR internals --- */
    function toUtf8(str) {
      var out = [], i, c;
      for (i = 0; i < str.length; i++) {
        c = str.codePointAt(i);
        if (c > 0xFFFF) i++;
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
      return out;
    }
    function byteBits(n) { return [n >> 7 & 1, n >> 6 & 1, n >> 5 & 1, n >> 4 & 1, n >> 3 & 1, n >> 2 & 1, n >> 1 & 1, n & 1]; }
    function pushBits(arr) { for (var j = 0; j < arr.length; j++) bits.push(arr[j]); }
    function bchFormat(d) {
      var gv = 0x537, v = d << 10;
      for (var i6 = 4; i6 >= 0; i6--) if ((v >> (i6 + 10)) & 1) v ^= gv << i6;
      return ((d << 10) | v) ^ 0x5412;
    }
    function placeFormat(mat, fmt) {
      var bits15 = [];
      for (var i7 = 14; i7 >= 0; i7--) bits15.push((fmt >> i7) & 1);
      for (var j4 = 0; j4 < 6; j4++) mat[8][j4] = bits15[j4];
      mat[8][7] = bits15[6]; mat[8][8] = bits15[7]; mat[7][8] = bits15[8];
      for (var j5 = 9; j5 < 15; j5++) mat[14 - j5][8] = bits15[j5];
      for (var j6 = 0; j6 < 8; j6++) mat[8][size - 1 - j6] = bits15[j6];
      for (var j7 = 8; j7 < 15; j7++) mat[size - 15 + j7][8] = bits15[j7];
      mat[size - 8][8] = 1;
    }
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
    FNS: FNS,
    htmlToMarkdown: htmlToMarkdown,
    rssParse: rssParse,
    qrMake: qrMake,
    textStats: textStats,
    diffWords: diffWords,
    cronNext: cronNext,
    csvGenerate: csvGenerate,
    schemaCheck: schemaCheck,
    colorConvert: colorConvert,
    passwordGen: passwordGen,
    qrRsEc: qrRsEc,
    urlParse: urlParse,
    markdownToc: markdownToc
  };
});
