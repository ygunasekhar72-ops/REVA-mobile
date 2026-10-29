/* REVA — real terminal overlay (PolyDev-style clean mobile terminal).
   Android (APK): a REAL pty (busybox `script` wrapping /system/bin/sh -i).
   Keystrokes pass through raw — the shell handles echo, line editing, history
   and Ctrl+C itself; output streams back live. Full unrestricted shell.
   Mobile helpers: extra-keys row (Esc/Tab/Ctrl/arrows/pipes), font size,
   paste, one-tap session restart.
   Browser: harness console backend until a WASM backend is bundled. */
(function () {
  var $ = H.$;
  var term = null, backend = null, busy = false;
  var line = '', hist = [], histPos = 0;
  var PROMPT = '❯ ';
  var ctrlArmed = false;

  function isAndroid() { return !!(window.REVAShell && (window.REVAShell.writeRaw || window.REVAShell.write)); }
  function fontSize() {
    var n = parseInt(localStorage.getItem('reva.termFs') || '13', 10);
    return isNaN(n) ? 13 : Math.min(22, Math.max(9, n));
  }
  function applyFont(n) {
    n = Math.min(22, Math.max(9, n));
    localStorage.setItem('reva.termFs', String(n));
    if (!term) return;
    try { term.options.fontSize = n; } catch (e) { try { term.setOption('fontSize', n); } catch (e2) { } }
    setTimeout(fit, 30);
  }

  function open() {
    var el = $('#terminal');
    if (!el || typeof Terminal === 'undefined') { H.toast('Terminal unavailable'); return; }
    el.style.display = 'flex';
    if (!term) {
      term = new Terminal({
        cursorBlink: true, fontSize: fontSize(), fontFamily: 'ui-monospace, Consolas, Menlo, monospace',
        theme: {
          background: '#0a0a0e', foreground: '#e9e9f0', cursor: '#f4f4f6', cursorAccent: '#0a0a0e',
          selectionBackground: '#2e4568', black: '#111318', brightBlack: '#6f7280',
          green: '#4fd08a', blue: '#63b3ed', cyan: '#5ed4d4', red: '#f2777a',
          yellow: '#e8c56f', magenta: '#c792ea', brightWhite: '#f7f7fb'
        },
        scrollback: 5000, convertEol: false,
        allowProposedApi: false
      });
      term.open($('#termHost'));
      window.__termInst = term;
      backend = isAndroid() ? 'android' : 'console';
      var be = $('#termBackend');
      if (be) be.textContent = backend === 'android' ? 'device shell · pty' : 'harness console';
      if (backend === 'android') {
        window.__revaTermOut = function (chunk) { term.write(chunk); };
        // header BEFORE start(): the session's own banner (REVA Linux / host
        // shell) then lands under it, in order, as it does on the device
        term.writeln('\x1b[1mREVA shell\x1b[0m — real pty · REVA Linux (Alpine via proot) + busybox (~300 cmds) + ripgrep');
        term.writeln('\x1b[2mtry: apk add git · pkg install curl · lx · rg pattern\x1b[0m\r');
        REVAShell.start();
        /* one-shot pty sizing: the device knows the real dimensions, so
           full-screen apps (vim, top) get them from the first paint. Sent
           once at session start — guaranteed to land at a shell prompt;
           never re-sent mid-session (it would type into running apps). */
        setTimeout(function () {
          try {
            var cols = Math.max(20, Math.floor($('#termHost').clientWidth / (fontSize() * 0.6)));
            var rows = Math.max(8, Math.floor($('#termHost').clientHeight / (fontSize() * 1.5)));
            REVAShell.writeRaw('stty rows ' + rows + ' cols ' + cols + '\n');
          } catch (e) { }
        }, 700);
      } else {
        term.writeln('\x1b[1mREVA terminal\x1b[0m — harness console backend (browser). \x1b[2mhelp\x1b[0m lists commands.');
        term.writeln('\x1b[2mThe Android APK runs a real unrestricted device shell here.\x1b[0m\r\n');
        term.write(PROMPT);
      }
      wire();
    }
    /* Escape closes the terminal while it is open (self-contained, re-armed
       on every open — close() removes the listener) */
    document.addEventListener('keydown', termEsc);
    term.focus();
    fit();
  }
  function termEsc(e) {
    if (e.key === 'Escape') {
      var el = $('#terminal');
      if (el && el.style.display !== 'none') { close(); }
    }
  }

  function close() {
    var el = $('#terminal');
    if (el) el.style.display = 'none';
    document.removeEventListener('keydown', termEsc);
    /* return to the last real screen: an open chat, else the home screen */
    try {
      if (window.App && window.App.openChat && Store.active()) window.App.openChat();
    } catch (e) { }
  }

  function fit() {
    if (!term) return;
    try { term.resize(Math.max(20, Math.floor($('#termHost').clientWidth / (fontSize() * 0.6))), Math.max(8, Math.floor($('#termHost').clientHeight / (fontSize() * 1.5)))); } catch (e) { }
  }

  function send(data) {
    if (backend === 'android') { REVAShell.writeRaw(data); return; }
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
  }

  function wire() {
    term.onData(function (data) {
      if (ctrlArmed && data.length === 1 && data >= 'a' && data <= 'z') {
        ctrlArmed = false; armCtrl(false);
        send(String.fromCharCode(data.charCodeAt(0) - 96));
        return;
      }
      if (ctrlArmed && data.length === 1 && data >= 'A' && data <= 'Z') {
        ctrlArmed = false; armCtrl(false);
        send(String.fromCharCode(data.charCodeAt(0) - 64));
        return;
      }
      if (ctrlArmed && data.length === 1) { ctrlArmed = false; armCtrl(false); }
      send(data);
    });
    window.addEventListener('resize', fit);

    /* extra keys row */
    $('#termKeys').addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      var k = b.getAttribute('data-k');
      if (k === 'esc') { send('\u001b'); if (backend !== 'android') term.write('\x1b'); }
      else if (k === 'tab') { send('\t'); if (backend !== 'android') term.write('\t'); }
      else if (k === 'ctrl') { ctrlArmed = !ctrlArmed; armCtrl(ctrlArmed); }
      else if (k === 'paste') { paste(); }
      else if (k === 'up') send('\u001b[A');
      else if (k === 'down') send('\u001b[B');
      else if (k === 'left') send('\u001b[D');
      else if (k === 'right') send('\u001b[C');
      else if (k === 'ch') { send(b.textContent); if (backend !== 'android') { line += b.textContent; term.write(b.textContent); } }
    });

    /* header controls */
    var home = $('#termHome'), cls = $('#termClose');
    if (home) home.onclick = function () { close(); };
    if (cls) cls.onclick = function () { close(); };
    var bm = $('#termFontMinus'), bp = $('#termFontPlus');
    if (bm) bm.onclick = function () { applyFont(fontSize() - 1); };
    if (bp) bp.onclick = function () { applyFont(fontSize() + 1); };
    var rs = $('#termRestart');
    if (rs) rs.onclick = function () {
      if (backend === 'android' && window.REVAShell && REVAShell.interrupt) {
        REVAShell.interrupt(); H.toast('Shell restarted');
      } else { term.clear(); term.write('\x1b[2m[session cleared]\x1b[0m\r\n'); term.write(PROMPT); line = ''; }
    };
    var cl = $('#termClear');
    if (cl) cl.onclick = function () { term.clear(); term.focus(); };
  }

  function armCtrl(on) {
    var b = $('#termCtrl');
    if (b) b.classList.toggle('armed', !!on);
  }

  function paste() {
    var done = function (t) {
      if (!t) { H.toast('Clipboard empty'); return; }
      if (backend === 'android') { REVAShell.writeRaw(t); return; }
      var one = String(t).replace(/[\r\n]+$/, '');
      line += one; term.write(one);
    };
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(done).catch(function () { H.toast('Paste blocked — long-press the terminal to paste'); });
    } else H.toast('Paste unavailable here');
  }

  function redraw(text) {
    term.write('\r\x1b[K' + PROMPT + text);
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
    if (backend === 'android') { REVAShell.writeRaw(cmd + '\n'); return; }
    term.write(cmd + '\r\n');
    run(cmd);
  }

  window.Term = {
    open: open, close: close, fit: fit, type: type,
    get fontPx() { return fontSize(); }
  };
})();
