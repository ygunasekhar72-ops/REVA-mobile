/* REVA — real terminal overlay.
   Android (APK): a persistent interactive /system/bin/sh session — the shell
   itself interprets pipes, redirects, and chaining; output streams live into
   xterm.js. This is the Termux architecture (minus the PTY: ^C restarts).
   Browser: harness console backend until a WASM backend is bundled. */
(function () {
  var $ = H.$;
  var term = null, backend = null, busy = false;
  var line = '', hist = [], histPos = 0;
  var PROMPT = '❯ ';

  function isAndroid() { return !!(window.REVAShell && window.REVAShell.write); }

  function open() {
    var el = $('#terminal');
    if (!el || typeof Terminal === 'undefined') { H.toast('Terminal unavailable'); return; }
    el.style.display = 'flex';
    if (!term) {
      term = new Terminal({
        cursorBlink: true, fontSize: 13, fontFamily: 'ui-monospace, Consolas, monospace',
        theme: { background: '#0a0a0c', foreground: '#e8e8ee', cursor: '#f4f4f6' },
        scrollback: 2000, convertEol: false
      });
      term.open($('#termHost'));
      window.__termInst = term;
      backend = isAndroid() ? 'android' : 'console';
      var be = $('#termBackend');
      if (be) be.textContent = backend === 'android' ? 'device shell · interactive' : 'harness console';
      if (backend === 'android') {
        window.__revaTermOut = function (chunk) { term.write(chunk); };
        REVAShell.start();
        term.writeln('\x1b[1mREVA shell\x1b[0m — real interactive /system/bin/sh (app sandbox).');
        term.writeln('\x1b[2mfull shell syntax works: pipes |, redirects > <, && ; — ^C restarts the shell\x1b[0m\r\n');
      } else {
        term.writeln('\x1b[1mREVA terminal\x1b[0m — harness console backend (browser). \x1b[2mhelp\x1b[0m lists commands.');
        term.writeln('\x1b[2mThe Android APK runs a real interactive device shell here.\x1b[0m\r\n');
        term.write(PROMPT);
      }
      wire();
    }
    term.focus();
    fit();
  }
  function close() { var el = $('#terminal'); if (el) el.style.display = 'none'; }

  function fit() {
    if (!term) return;
    try { term.resize(Math.max(20, Math.floor($('#termHost').clientWidth / 7.8)), Math.max(8, Math.floor($('#termHost').clientHeight / 15.6))); } catch (e) {}
  }

  function wire() {
    term.onData(function (data) {
      if (backend === 'console' && busy) {
        if (data === '\u0003') { busy = false; term.write('^C\r\n' + PROMPT); }
        return;
      }
      if (data === '\r') {
        term.write('\r\n');
        var cmd = line; line = '';
        if (cmd.trim()) { hist.push(cmd); }
        histPos = hist.length;
        if (backend === 'android') {
          // the shell echoes its own prompt; just forward the line
          REVAShell.write(cmd);
        } else {
          run(cmd);
        }
      } else if (data === '\u007f') {
        if (line.length) { line = line.slice(0, -1); term.write('\b \b'); }
      } else if (data === '\u0003') {
        if (backend === 'android') { REVAShell.interrupt(); line = ''; }
        else { term.write('^C\r\n' + PROMPT); line = ''; }
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
    term.write('\r\x1b[K' + (backend === 'android' ? '' : PROMPT) + text);
    line = text;
  }

  function run(cmd) {
    if (!cmd.trim()) { term.write(PROMPT); return; }
    busy = true;
    var r = Console.exec(cmd);
    if (r.clear) term.clear();
    else if (r.out) term.writeln(r.out);
    busy = false;
    term.write(PROMPT);
  }

  /* feed a line into the terminal as if typed (automation + tests) */
  function type(cmd) {
    if (!term || (backend === 'console' && busy)) return;
    term.write(cmd + '\r\n');
    if (backend === 'android') REVAShell.write(cmd);
    else run(cmd);
  }

  window.Term = { open: open, close: close, fit: fit, type: type };
})();
