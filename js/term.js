/* REVA — real terminal overlay.
   Backend priority:
   1. Android shell bridge (APK builds): real processes — argv only, never a
      shell string. The line is tokenized here, operators are rejected, and the
      token array is passed to the native bridge as JSON.
   2. Browser: the harness console running on a full xterm.js interface
      (line editing, history, Ctrl+C) until a WASM backend is bundled. */
(function () {
  var $ = H.$;
  var term = null, backend = null, busy = false;
  var line = '', hist = [], histPos = 0;
  var PROMPT = '❯ ';
  var OPS = ['|', '>', '<', '&&', ';', '`', '$('];

  /* quote-aware tokenizer — mirrors the native-side parser */
  function tokenize(cmd) {
    var out = [], cur = '', q = 0;
    for (var i = 0; i < cmd.length; i++) {
      var c = cmd.charAt(i);
      if (q) { if (c === q) q = 0; else cur += c; }
      else if (c === '\'' || c === '"') q = c;
      else if (c === ' ' || c === '\t') { if (cur) { out.push(cur); cur = ''; } }
      else cur += c;
    }
    if (cur) out.push(cur);
    return out;
  }
  /* one command at a time — shell operators are refused, not interpreted */
  function checkSafe(cmd) {
    for (var i = 0; i < OPS.length; i++) if (cmd.indexOf(OPS[i]) >= 0) return false;
    return true;
  }

  function open() {
    var el = $('#terminal');
    if (!el || typeof Terminal === 'undefined') { H.toast('Terminal unavailable'); return; }
    el.style.display = 'flex';
    if (!term) {
      term = new Terminal({
        cursorBlink: true, fontSize: 13, fontFamily: 'ui-monospace, Consolas, monospace',
        theme: { background: '#0a0a0c', foreground: '#e8e8ee', cursor: '#f4f4f6' },
        scrollback: 2000, convertEol: true
      });
      term.open($('#termHost'));
      window.__termInst = term;
      var be = $('#termBackend');
      if (be) be.textContent = (window.REVAShell && window.REVAShell.execArgv) ? 'device shell' : 'harness console';
      backend = (window.REVAShell && window.REVAShell.execArgv) ? 'android' : 'console';
      wire();
      banner();
    }
    term.focus();
    fit();
  }
  function close() { var el = $('#terminal'); if (el) el.style.display = 'none'; }

  function fit() {
    if (!term) return;
    try { term.resize(Math.max(20, Math.floor($('#termHost').clientWidth / 7.8)), Math.max(8, Math.floor($('#termHost').clientHeight / 15.6))); } catch (e) {}
  }

  function banner() {
    if (backend === 'android') {
      term.writeln('\x1b[1mREVA shell\x1b[0m — real device processes (app sandbox, one command at a time).');
      term.writeln('\x1b[2mshell operators (| > < && ;) are not interpreted\x1b[0m');
    } else {
      term.writeln('\x1b[1mREVA terminal\x1b[0m — harness console backend (browser). \x1b[2mhelp\x1b[0m lists commands.');
      term.writeln('\x1b[2mThe Android APK runs real device commands here.\x1b[0m');
    }
    term.write('\r\n' + PROMPT);
  }

  function wire() {
    term.onData(function (data) {
      if (busy) {
        if (data === '\u0003') { busy = false; term.write('^C\r\n' + PROMPT); }
        return;
      }
      if (data === '\r') {
        term.write('\r\n');
        var cmd = line; line = '';
        if (cmd.trim()) { hist.push(cmd); }
        histPos = hist.length;
        run(cmd);
      } else if (data === '\u007f') {
        if (line.length) { line = line.slice(0, -1); term.write('\b \b'); }
      } else if (data === '\u0003') {
        term.write('^C\r\n' + PROMPT); line = '';
      } else if (data === '\u001b[A') {
        if (histPos > 0) { histPos--; redraw(hist[histPos] || ''); }
      } else if (data === '\u001b[B') {
        if (histPos < hist.length) { histPos++; redraw(hist[histPos] || ''); }
      } else if (data === '\u001b[C' || data === '\u001b[D') {
        /* simple line editor — no cursor motion */
      } else if (data >= ' ' && data <= '~' && data !== '\t') {
        line += data; term.write(data);
      }
    });
    window.addEventListener('resize', fit);
  }
  function redraw(text) {
    term.write('\r\x1b[K' + PROMPT + text);
    line = text;
  }

  function run(cmd) {
    if (!cmd.trim()) { term.write(PROMPT); return; }
    if (!checkSafe(cmd)) {
      term.writeln('one command at a time — shell operators (| > < && ;) are not supported');
      term.write(PROMPT);
      return;
    }
    busy = true;
    if (backend === 'android') {
      var argv = tokenize(cmd);
      var cbId = 'revacbs.' + Date.now();
      window.__revaCb = window.__revaCb || {};
      window.__revaCb[cbId] = function (out) {
        delete window.__revaCb[cbId];
        if (out && out.trim()) term.writeln(out.replace(/\n$/, ''));
        busy = false;
        term.write(PROMPT);
      };
      try {
        window.REVAShell.execArgv(JSON.stringify(argv), 'window.__revaCb["' + cbId + '"]');
      } catch (e) {
        term.writeln('shell error: ' + e.message);
        busy = false; term.write(PROMPT);
      }
      return;
    }
    var r = Console.exec(cmd);
    if (r.clear) term.clear();
    else if (r.out) term.writeln(r.out);
    busy = false;
    term.write(PROMPT);
  }

  /* feed a line into the terminal as if typed (automation + tests) */
  function type(cmd) {
    if (!term || busy) return;
    term.write(cmd + '\r\n');
    run(cmd);
  }

  window.Term = { open: open, close: close, fit: fit, type: type };
})();
