/* REVA — agent shell execution channel (Android APK).
   A private, hidden /system/bin/sh session (REVAAgent) owned by the AI agent,
   fully separate from any UI session. Commands run
   through a marker protocol that yields output + real exit codes; cwd and env
   persist within the session. The parser is a pure function (unit-tested). */
(function () {
  var ID_RE = /__REVA_DONE__(\d+)__([\w.-]+)(\n|$)/;
  var MAX_CAPTURE = 65536;
  var WEDGE_LIMIT = 3;   // consecutive timeouts before the channel is declared wedged
  var PROBE_MS = 8000;   // fast recovery-probe budget (vs the 120s command default)

  /* pure: feed chunks + a target id, get {done, exit, out}
     strips the non-pty shell's "$ " prompt noise; exposed for unit tests */
  function parse(state, chunk, wantId) {
    state.buf = (state.buf || '') + chunk;
    var m = state.buf.match(ID_RE);
    while (m) {
      var before = state.buf.slice(0, m.index);
      if (m[2] === wantId) {
        state.buf = state.buf.slice(m.index + m[0].length);
        var out = (before + state.buf)
          .replace(/^\$\s*$/gm, '')   // standalone prompts
          .replace(/\$\s*$/g, '')     // trailing prompt fragment before the marker
          .replace(/\s+$/, '');
        return { done: true, exit: parseInt(m[1], 10), out: out };
      }
      // some other execution's marker — drop everything up to it
      state.buf = state.buf.slice(m.index + m[0].length);
      m = state.buf.match(ID_RE);
    }
    return { done: false };
  }

  var started = false;
  function ensure() {
    if (started || !window.REVAAgent) return started;
    started = true;
    window.__revaAgentOut = function (chunk) {
      if (AgentExec._pending && AgentExec._pending.collect) AgentExec._pending.collect(chunk);
    };
    REVAAgent.start();
    return true;
  }

  /* run a shell task: (task, {cwd, timeoutMs}) → {out, exit, timedOut}
     Transport is pure passthrough: the command goes verbatim to the private
     shell's stdin, then a constant marker line reports the real exit code.
     Nothing is templated around the command text. */
  function run(task, opts) {
    if (!window.REVAAgent) {
      return Promise.resolve({ out: 'Error: shell_exec is only available in the REVA Android app', exit: -1 });
    }
    ensure();
    opts = opts || {};
    var timeoutMs = Math.min(Math.max(+opts.timeoutMs || 120000, 5000), 600000);
    var id = 'x' + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
    var state = { buf: '' };
    var self = AgentExec;
    if (self._pending) { return Promise.resolve({ out: 'Error: another shell_exec is still running', exit: -1 }); }
    if (!opts._probe && (self.consecTimeouts || 0) >= WEDGE_LIMIT) {
      /* circuit breaker: the channel has timed out WEDGE_LIMIT times in a row.
         Verify with one fast probe instead of burning the full command timeout;
         if the probe answers, the channel recovered — proceed transparently. */
      return run('echo reva-probe-ok', { timeoutMs: PROBE_MS, _probe: true }).then(function (p) {
        if (!p.timedOut) return run(task, opts);
        return {
          out: 'Error: shell channel unresponsive — ' + self.consecTimeouts + ' consecutive timeouts and the recovery probe also timed out. Do NOT call shell_exec again this round: continue with the built-in tools (read_file, write_file, edit_file, list_files, workspace_search, run_check) which do not need the shell, then retry shell_exec later — REVA probes for recovery automatically.',
          exit: -1, wedged: true
        };
      });
    }

    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        finish({ timedOut: true });
        try { REVAAgent.interrupt(); } catch (e) {} // kill the stuck command; fresh shell keeps the channel alive
      }, timeoutMs);
      function finish(extra) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        self._pending = null;
        if (extra && extra.timedOut) self.consecTimeouts = (self.consecTimeouts || 0) + 1;
        else self.consecTimeouts = 0; // any completed execution (incl. a healthy probe) proves the channel alive
        resolve(extra || {});
      }
      self._pending = {
        collect: function (chunk) {
          if (settled) return;
          var r = parse(state, chunk, id);
          if (state.buf.length > MAX_CAPTURE * 2) state.buf = state.buf.slice(-MAX_CAPTURE);
          if (r.done) {
            /* head+tail capture: the command echo lives at the start, the
               error/exit detail at the end — a single-side slice loses one */
            var o = String(r.out || '');
            if (o.length > MAX_CAPTURE) {
              o = o.slice(0, 8000) + '\n[… ' + (o.length - 64000) + ' chars truncated …]\n' + o.slice(-56000);
            }
            finish({ out: o, exit: r.exit });
          }
        }
      };
      if (opts.cwd) {
        REVAAgent.writeRaw('cd ');
        REVAAgent.writeRaw(String(opts.cwd).replace(/\n/g, ' '));
        REVAAgent.writeRaw('\n');
      }
      REVAAgent.writeRaw(String(task).replace(/\n+$/, ''));
      REVAAgent.writeRaw('\n');
      REVAAgent.writeRaw('echo __REVA_DONE__$?__');
      REVAAgent.writeRaw(id);
      REVAAgent.writeRaw('\n');
    });
  }

  /* argv-style execution: callers pass an argument ARRAY, never a composed
     command string. Each argument is shell-quoted here (single reviewed
     place) so no caller can inject shell syntax — the JS equivalent of
     subprocess.run(argv, shell=False). Bare safe tokens stay unquoted. */
  function quoteShell(s) {
    s = String(s);
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }
  function runArgs(argv, opts) {
    var args = [];
    for (var i = 0; i < (argv || []).length; i++) {
      if (argv[i] === undefined || argv[i] === null) return Promise.resolve({ out: 'Error: execArgs got a null argument', exit: -1 });
      args.push(quoteShell(argv[i]));
    }
    return run(args.join(' '), opts);
  }

  window.AgentExec = { exec: run, execArgs: runArgs, parse: parse, ensure: ensure, consecTimeouts: 0, WEDGE_LIMIT: WEDGE_LIMIT, _pending: null };
})();
