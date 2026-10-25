/* REVA — agent shell execution channel (Android APK).
   A private, hidden /system/bin/sh session (REVAAgent) owned by the AI agent,
   fully separate from the user's interactive terminal session. Commands run
   through a marker protocol that yields output + real exit codes; cwd and env
   persist within the session. The parser is a pure function (unit-tested). */
(function () {
  var ID_RE = /__REVA_DONE__(\d+)__([\w.-]+)(\n|$)/;
  var MAX_CAPTURE = 65536;

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
     Transport is pure passthrough, exactly like the user's terminal: the
     command goes verbatim to the private shell's stdin, then a constant
     marker line reports the real exit code. Nothing is templated around the
     command text. */
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
        resolve(extra || {});
      }
      self._pending = {
        collect: function (chunk) {
          if (settled) return;
          var r = parse(state, chunk, id);
          if (state.buf.length > MAX_CAPTURE * 2) state.buf = state.buf.slice(-MAX_CAPTURE);
          if (r.done) finish({ out: (r.out || '').slice(0, MAX_CAPTURE), exit: r.exit });
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

  window.AgentExec = { exec: run, parse: parse, ensure: ensure, _pending: null };
})();
