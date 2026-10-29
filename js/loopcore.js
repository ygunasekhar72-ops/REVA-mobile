/* REVA — core-loop integrity primitives (pure, unit-tested).
   The loop must never die from its own history: when the model's context
   window fills mid-run, the transcript is compacted and the run continues.
   Also classifies context-exhaustion errors from real provider messages.
   Works in the browser (window.LoopCore) and node (module.exports) so the
   unit tests run the exact code the loop runs. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LoopCore = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  /* context-exhaustion errors, from the providers' actual wordings:
     OpenAI "maximum context length", Anthropic "prompt is too long",
     Gemini "input token count", generic "context length"/"too many tokens".
     Deliberately NOT matched by quota ("limit reached", "monthly limit"). */
  function isContextError(e) {
    var m = String((e && e.message) || e || '');
    return /maximum context length|context length|prompt is too long|input token count|too many tokens|context window|exceeds the maximum|reduce the length/i.test(m);
  }

  /* segment a transcript into atomic groups so compaction can never
     orphan a tool message (providers 400 on tool results whose
     assistant tool_calls message is missing) */
  function groupify(msgs) {
    var groups = [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (m.role === 'assistant' && m.tool_calls) {
        var g = [m];
        while (i + 1 < msgs.length && msgs[i + 1].role === 'tool') g.push(msgs[++i]);
        groups.push(g);
      } else {
        groups.push([m]);
      }
    }
    return groups;
  }

  function groupChars(g) {
    var n = 0;
    for (var i = 0; i < g.length; i++) {
      n += String(g[i].content || '').length;
      if (g[i].tool_calls) for (var j = 0; j < g[i].tool_calls.length; j++) n += String(g[i].tool_calls[j].function.arguments || '').length;
    }
    return n;
  }

  /* compact from the END: walk whole groups backwards until keepChars of
     recent context is retained. Returns { kept, dropped } — the caller
     re-attaches its system message and appends the continuation note.
     Dropped groups are gone entirely (no JSON-slicing, no invalid args). */
  function compactTranscript(msgs, keepChars) {
    var groups = groupify(msgs || []);
    var kept = [], budget = 0, dropped = 0;
    for (var i = groups.length - 1; i >= 0; i--) {
      var gc = groupChars(groups[i]);
      if (budget + gc > keepChars && kept.length) break;
      kept.unshift(groups[i]);
      budget += gc;
    }
    /* the oldest kept group may still be a tool group if the budget was
       never met (single huge group) — that's safe: nothing was dropped */
    for (var d = 0; d < groups.length; d++) if (kept.indexOf(groups[d]) < 0) dropped += groups[d].length;
    return { kept: kept.reduce(function (a, g) { return a.concat(g); }, []), dropped: dropped };
  }

  /* read-only Tools.run tools that may run concurrently. Anything mutating,
     stateful, shell-backed, hook-UI-bound or special-cased in the dispatch
     loop stays on the ordered sequential path. A batch qualifies only when
     EVERY call is safe and there is more than one call. */
  var PARALLEL_SAFE = /^(read_file|list_files|workspace_search|code_symbols|memory_search|lint|test_data)$/;
  function isParallelSafe(names) {
    if (!names || names.length < 2) return false;
    for (var i = 0; i < names.length; i++) if (!PARALLEL_SAFE.test(String(names[i]))) return false;
    return true;
  }

  /* ---- ripgrep integration (search at scale) ----
     Pure argv construction + output parsing so the real binary is exercised
     identically in tests. rg exit codes: 0 = matches, 1 = none, 2 = error. */
  function rgArgs(pattern, dir, opts) {
    opts = opts || {};
    var argv = ['rg', '--line-number', '--no-heading', '--smart-case', '--max-filesize', '512K'];
    if (opts.glob) { argv.push('--glob', String(opts.glob)); }
    if (!opts.isRegex) argv.push('--fixed-strings');
    argv.push('-e', String(pattern), String(dir));
    return argv;
  }

  function parseRg(text, maxResults) {
    var hits = [], total = 0;
    String(text || '').split('\n').forEach(function (line) {
      if (!line) return;
      var m = line.match(/^([^:]+):(\d+):(.*)$/);
      if (!m) return;
      total++;
      if (hits.length < (maxResults || 60)) hits.push({ path: m[1], line: parseInt(m[2], 10), text: m[3].slice(0, 160) });
    });
    return { hits: hits, total: total };
  }

  /* three.js provider (leverage doctrine): projects importing the bare
     'three' specifier get an import map pointing at the HARNESS's vendored
     copy (js/vendor/three/) — offline, local-first, no CDN. If the project
     ships its OWN import map pointing three at a CDN, the map is REWRITTEN
     to the vendored path (offline-first wins; explicit local paths are
     respected). Pure + tested. */
  function injectThreeMap(html) {
    var s = String(html || '');
    if (!/(?:from\s*|import\s*\(?\s*|import\s*)(['"])three(\/addons[^'"]*)?\1/.test(s)) return s;
    var map = '<scr' + 'ipt type="importmap">{"imports":{"three":"js/vendor/three/three.module.js","three/addons/":"js/vendor/three/addons/"}}</scr' + 'ipt>';
    if (s.indexOf('importmap') >= 0) {
      /* project-owned map: rewrite only CDN three entries to the vendored copy */
      s = s.replace(/(["']three["']\s*:\s*["'])(https?:\/\/[^"']+three\.module\.js)(["'])/g, '$1js/vendor/three/three.module.js$3');
      s = s.replace(/(["']three\/addons\/["']\s*:\s*["'])(https?:\/\/[^"']+)(["'])/g, '$1js/vendor/three/addons/$3');
      return s;
    }
    if (s.indexOf('<head>') >= 0) return s.split('<head>').join('<head>' + map);
    return map + s;
  }

  /* ---- unified tool-call watchdog + per-tool circuit breaker (L1) ----
     Budgets apply to tools that can HANG (network/iframe); local file ops
     are exempt (side-effect safety: a timed-out write must not be discarded
     while still possibly landing). 3 consecutive timeouts wedge the tool —
     further calls fail fast for a cooldown, then get one fresh budget. */
  var DEFAULT_BUDGETS = {
    web_search: 45000, web_read: 45000, browser_open: 30000, browser_read: 45000,
    fetch_asset: 60000, image_gen: 120000, run_check: 90000, screenshot: 45000,
    interact: 90000
  };
  var WEDGE_COOLDOWN_MS = 120000;

  function makeToolHealth() { return {}; }

  /* withBudget(run, name, health) — run is a FUNCTION returning the promise
     (lazy: wedged tools never start the underlying call) */
  function withBudget(run, name, health) {
    var H = health || {};
    var budget = (DEFAULT_BUDGETS[name] || 90000);
    var th = H[name] = H[name] || { consec: 0 };
    var now = Date.now();
    if (th.wedgedUntil && now < th.wedgedUntil) {
      return Promise.resolve({
        timedOut: false, wedged: true, exit: -1,
        out: 'Error: ' + name + ' was unresponsive (' + th.lastConsec + ' consecutive timeouts recently) — call skipped without running. It will be allowed again automatically; continue with other work meanwhile.'
      });
    }
    var settled = false;
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        th.consec = (th.consec || 0) + 1;
        th.lastConsec = th.consec;
        var wedgedNow = false;
        if (th.consec >= 3) { th.wedgedUntil = now + WEDGE_COOLDOWN_MS; th.consec = 0; wedgedNow = true; }
        resolve({
          timedOut: true, wedged: wedgedNow, exit: -1,
          out: 'Error: ' + name + ' timed out after ' + Math.round(budget / 1000) + 's and was treated as failed' + (wedgedNow ? ' — the tool is now on cooldown and further calls will be skipped briefly' : '') + '. React to this like any tool failure.'
        });
      }, budget);
      Promise.resolve()
        .then(run)
        .then(function (v) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          th.consec = 0; // any completion proves the tool alive
          resolve({ ok: true, value: v });
        })
        .catch(function (e) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          th.consec = 0;
          resolve({ ok: false, out: 'Error: ' + String((e && e.message) || e) });
        });
    });
  }

  return { isContextError: isContextError, groupify: groupify, compactTranscript: compactTranscript, isParallelSafe: isParallelSafe, rgArgs: rgArgs, parseRg: parseRg, injectThreeMap: injectThreeMap, withBudget: withBudget, makeToolHealth: makeToolHealth, DEFAULT_BUDGETS: DEFAULT_BUDGETS };
});
