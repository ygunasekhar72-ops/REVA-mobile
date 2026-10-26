/* Calculator plugin — registers a real `calc` tool.
   Implemented as a small recursive-descent parser: NO dynamic code
   evaluation, so expressions can never execute anything but math. */
register({
  name: 'calc',
  description: 'Evaluate a math expression precisely. Supports + - * / % ^ ( ), and functions sqrt sin cos tan ln log abs round floor ceil min max pow, constants pi and e.',
  parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
  run: function (args) {
    var src = String(args.expression || '');
    var FN = {
      sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan,
      ln: Math.log, log: Math.log10 || function (x) { return Math.log(x) / Math.LN10; },
      abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
      min: Math.min, max: Math.max, pow: Math.pow
    };
    var CONST = { pi: Math.PI, e: Math.E };
    var pos = 0;
    function ws() { while (pos < src.length && /\s/.test(src[pos])) pos++; }
    function num() {
      ws();
      var m = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(pos));
      if (!m) return null;
      pos += m[0].length;
      return parseFloat(m[0]);
    }
    function ident() {
      ws();
      var m = /^[a-z]+/i.exec(src.slice(pos));
      if (!m) return null;
      pos += m[0].length;
      return m[0].toLowerCase();
    }
    function factor() {
      ws();
      if (src[pos] === '(') { pos++; var v = expr(); ws(); if (src[pos] !== ')') throw new Error('missing )'); pos++; return v; }
      if (src[pos] === '-') { pos++; return -factor(); }
      if (src[pos] === '+') { pos++; return factor(); }
      var id = ident();
      if (id !== null) {
        if (id in CONST) return CONST[id];
        if (!(id in FN)) throw new Error('unknown name: ' + id);
        ws();
        if (src[pos] !== '(') throw new Error('expected ( after ' + id);
        pos++;
        var argv = [expr()];
        ws();
        while (src[pos] === ',') { pos++; argv.push(expr()); ws(); }
        if (src[pos] !== ')') throw new Error('missing ) in ' + id);
        pos++;
        return FN[id].apply(null, argv);
      }
      var n = num();
      if (n === null) throw new Error('unexpected character at ' + pos);
      return n;
    }
    function power() {
      var base = factor();
      ws();
      if (src[pos] === '^') { pos++; return Math.pow(base, power()); }
      return base;
    }
    function term() {
      var v = power();
      while (true) {
        ws();
        var op = src[pos];
        if (op === '*') { pos++; v *= power(); }
        else if (op === '/') { pos++; var d = power(); if (d === 0) throw new Error('division by zero'); v /= d; }
        else if (op === '%') { pos++; v %= power(); }
        else return v;
      }
    }
    function expr() {
      var v = term();
      while (true) {
        ws();
        var op = src[pos];
        if (op === '+') { pos++; v += term(); }
        else if (op === '-') { pos++; v -= term(); }
        else return v;
      }
    }
    var result;
    try { result = expr(); ws(); if (pos < src.length) throw new Error('unexpected trailing input'); }
    catch (e) { return 'Error: ' + e.message; }
    if (typeof result !== 'number' || !isFinite(result)) return 'Error: did not produce a finite number';
    return src.trim() + ' = ' + String(result);
  }
});
