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
  var PARALLEL_SAFE = /^(read_file|list_files|workspace_search|code_symbols|memory_search|lint|test_data|todo_scan|word_count|math_eval|encode_decode|diff_texts|hash_text|json_query|csv_parse|uuid_key|test_gen)$/;
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
    interact: 90000, http_request: 45000
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

  /* ---- L2b edit recovery: the fuzzy edit ladder (aider-class) ----
     Tier 0: verbatim. Tier 1: whitespace-normalized (indentation drift).
     Tier 2: best-effort fuzzy match, applied only when confidently unique
     (score >= 0.7, no close runner-up). Otherwise: honest error with the
     nearest line. Models fail at exact text; the harness recovers. */
  function flatWs(s) {
    /* whitespace-normalized form: per-line trim + collapsed interior runs.
       (trim() first — split keeps a leading '' for indented lines, which
       would silently preserve indentation and kill the tier-1 match.) */
    return String(s == null ? '' : s).split('\n').map(function (l) { return l.trim().split(/\s+/).join(' '); }).join(' ');
  }
  function nearestLine(text, needle) {
    var toks = (needle.toLowerCase().match(/[a-z0-9_$]{3,}/g) || []).filter(function (w, i, a) { return a.indexOf(w) === i; });
    if (!toks.length) return null;
    var best = null;
    String(text).split('\n').forEach(function (line, i) {
      var low = line.toLowerCase(), sc = 0;
      toks.forEach(function (w) { if (low.indexOf(w) >= 0) sc++; });
      if (sc && (!best || sc > best.sc)) best = { n: i + 1, sc: sc, line: line.trim().slice(0, 120) };
    });
    return best;
  }
  function simScore(a, b) {
    /* character-trigram Jaccard on DISTINCT trigrams (raw counts would let
       repeated code tokens inflate the denominator and sink real matches) */
    function grams(s) { var set = {}, n = 0; s = s.toLowerCase().replace(/\s+/g, ' '); for (var i = 0; i < s.length - 2; i++) { var g = s.slice(i, i + 3); if (!set[g]) { set[g] = 1; n++; } } return { set: set, n: n }; }
    var A = grams(a), B = grams(b);
    var inter = 0;
    for (var g in A.set) if (B.set[g]) inter++;
    return inter / Math.max(1, A.n + B.n - inter);
  }
  function fuzzyBest(text, oldStr) {
    /* score = 0.6 × positional line overlap + 0.4 × trigram similarity.
       Models re-type blocks at LINE granularity (renamed symbol, tweaked
       expression), so line overlap is the strong signal; trigrams catch
       reflowed lines. One drifted line in five must still score high:
       trigram-only collapses to 0.61 on exactly that case. */
    var lines = text.split('\n');
    var oLines = oldStr.split('\n');
    var win = oLines.length;
    if (win < 1 || win > lines.length) return null;
    var oFlat = oLines.map(flatWs);
    var want = oldStr.toLowerCase().replace(/\s+/g, ' ').trim();
    var best = null, second = 0;
    for (var s0 = 0; s0 + win <= lines.length; s0++) {
      var seg = lines.slice(s0, s0 + win);
      var matched = 0;
      for (var w = 0; w < win; w++) if (flatWs(seg[w]) === oFlat[w]) matched++;
      var region = seg.join('\n');
      var sc = 0.6 * (matched / win) + 0.4 * simScore(region, want);
      if (!best || sc > best.score) { second = best ? best.score : 0; best = { score: sc, index: text.indexOf(lines[s0]), region: region }; }
      else if (sc > second) second = sc;
    }
    if (best && best.score >= 0.5) return { score: best.score, runnerUp: second, index: best.index, region: best.region };
    return null;
  }
  /* ---- editLadder: the recovery tiers called when verbatim fails ----
     Tier 1: whitespace-normalized window match (indentation drift — the
     file's real indentation is preserved, the new content is re-indented).
     Tier 2: fuzzy window match, applied only when confidently unique
     (score >= 0.7 with no close runner-up). Returns {updated, recovery}
     or null (caller keeps its honest error). */
  function editLadder(text, oldStr, newStr) {
    var flat = flatWs(text), want = flatWs(oldStr);
    if (want.length > 3 && flat.indexOf(want) >= 0) {
      var linesT = text.split('\n');
      var wLines = oldStr.split('\n');
      for (var s0 = 0; s0 < linesT.length; s0++) {
        if (flatWs(linesT[s0]) !== flatWs(wLines[0])) continue;
        var win = linesT.slice(s0, s0 + wLines.length);
        if (win.length !== wLines.length) continue;
        var ok = true;
        for (var w = 0; w < wLines.length; w++) {
          if (flatWs(win[w]) !== flatWs(wLines[w])) { ok = false; break; }
        }
        if (ok) {
          /* re-indent by the offset between the window's and the model's
             first-line indent — relative structure survives either way the
             model writes it (dedented block OR copied real indents) */
          var nLines = newStr.split('\n');
          var nLead0 = (nLines[0].match(/^\s*/) || [''])[0];
          var off = ((win[0].match(/^\s*/) || [''])[0]).length - nLead0.length;
          var indented = nLines.map(function (l) {
            if (!l.trim()) return '';
            return off >= 0 ? new Array(off + 1).join(' ') + l : l.slice(-off);
          });
          var out = linesT.slice(0, s0).concat(indented, linesT.slice(s0 + wLines.length)).join('\n');
          return { updated: out, recovery: 'whitespace-normalized' };
        }
      }
    }
    var fz = fuzzyBest(text, oldStr);
    if (fz && fz.score >= 0.7 && (!fz.runnerUp || fz.score - fz.runnerUp >= 0.1)) {
      var before = text.slice(0, fz.index), after = text.slice(fz.index + fz.region.length);
      return { updated: before + newStr + after, recovery: 'fuzzy ' + Math.round(fz.score * 100) + '%' };
    }
    return null;
  }

  /* ---- L6 RunState: mid-run snapshot that survives process death ----
     A kill mid-round loses the tool rows that were already APPLIED (files
     written, edits landed) but never reached the transcript. The snapshot
     keeps those rows so the resume prompt tells the model exactly what
     landed — no repeated work, no ghost state. Pure + unit-tested. */
  var SNAPSHOT_CAP = 40;

  function snapshotRow(info) {
    var a = (info && info.args) || {};
    var where = a.path || a.cmd || a.query || a.title || '';
    return {
      t: String((info && info.name) || '?').slice(0, 40),
      p: String(where).slice(0, 120),
      ok: !!(info && info.ok),
      o: String((info && info.out) || '').slice(0, 160)
    };
  }
  function snapshotRun(toolResults) {
    return {
      v: 1,
      at: Date.now(),
      rows: (toolResults || []).slice(-SNAPSHOT_CAP).map(snapshotRow)
    };
  }
  function validRunState(st) {
    if (!st || st.v !== 1 || !Array.isArray(st.rows)) return null;
    var rows = st.rows.filter(function (r) {
      return r && typeof r.t === 'string';
    }).map(function (r) {
      return { t: String(r.t).slice(0, 40), p: String(r.p || '').slice(0, 120), ok: !!r.ok, o: String(r.o || '').slice(0, 160) };
    });
    return rows.length ? { v: 1, at: Number(st.at) || 0, rows: rows } : null;
  }
  /* the resume prompt's honest brief of what the dead round already did */
  function resumeBrief(st) {
    var v = validRunState(st);
    if (!v) return '';
    var lines = v.rows.map(function (r) {
      return '- ' + r.t + ' ' + r.p + (r.ok ? ' — ok' : ' — FAILED (react to this)');
    });
    return 'Mid-round work already applied before the interruption (' + v.rows.length + ' tool calls):\n' + lines.join('\n');
  }

  /* ---- W5 STATE-OF-THE-WORLD: the compaction replacement block ----
     When old messages are dropped, the run's LIVE state (task, todos,
     workspace, recent actions) is rebuilt from real session data — not
     model memory — so a 500-round run stays coherent. Pure + bounded. */
  function buildSotW(st) {
    st = st || {};
    var out = ['STATE OF THE WORLD (rebuilt from live session data):'];
    if (st.userText) out.push('- Task: ' + String(st.userText).replace(/\s+/g, ' ').slice(0, 160));
    var todos = Array.isArray(st.todos) ? st.todos : [];
    if (todos.length) {
      var done = todos.filter(function (t) { return t && t.done; }).length;
      var list = todos.slice(0, 8).map(function (t) {
        return (t && t.done ? '[x] ' : '[ ] ') + String(t.t || t.title || '').replace(/\s+/g, ' ').slice(0, 44);
      }).join('; ');
      out.push('- Todos (' + done + '/' + todos.length + ' done): ' + list);
    }
    var files = st.files || {};
    var paths = Object.keys(files);
    if (paths.length) {
      var bytes = 0;
      paths.forEach(function (p) { bytes += String(files[p] || '').length; });
      /* recency from tool rows first (they name what the agent touched),
         largest-by-lines as the fallback ordering */
      var touched = [];
      (Array.isArray(st.toolRows) ? st.toolRows : []).slice().reverse().forEach(function (r) {
        var p = String((r && (r.p || r.path)) || '');
        if (p && files[p] !== undefined && touched.indexOf(p) < 0 && touched.length < 4) touched.push(p);
      });
      var byLines = paths.slice().sort(function (a, b) { return String(files[b]).split('\n').length - String(files[a]).split('\n').length; });
      var recent = touched.concat(byLines.filter(function (p) { return touched.indexOf(p) < 0; })).slice(0, 5);
      var sizeStr = bytes < 1024 ? bytes + ' B' : Math.round(bytes / 102.4) / 10 + ' KB';
      out.push('- Workspace: ' + paths.length + ' file(s), ' + sizeStr + ' — key files: ' +
        recent.map(function (p) { return p + ' (' + String(files[p]).split('\n').length + ' ln)'; }).join(', '));
    }
    var rows = Array.isArray(st.toolRows) ? st.toolRows.slice(-4) : [];
    if (rows.length) {
      out.push('- Latest actions: ' + rows.map(function (r) {
        return String((r && (r.t || r.name)) || '?') + ' ' + String((r && (r.p || r.path)) || '') + (r && r.ok === false ? ' — FAILED' : '');
      }).join('; ').slice(0, 280));
    }
    out.push('- Todos, files and mounted projects are intact — continue EXACTLY where the transcript stopped.');
    var text = out.join('\n');
    return text.length > 1400 ? text.slice(0, 1397) + '…' : text;
  }

  /* ---- progressive tool disclosure: task-matched schemas within a budget ----
     68 schemas ≈ 29KB ≈ 7K tokens per request — fatal on small windows. The
     CORE set always rides; the rest are ranked by (a) usage telemetry,
     (b) keyword overlap between the task text and the tool's name+desc,
     and filled into the remaining byte budget. */
  var CORE_TOOLS = ['write_file', 'edit_file', 'read_file', 'list_files', 'create_directory', 'delete_file', 'todo_write', 'workspace_search', 'code_symbols', 'shell_exec', 'run_check', 'screenshot', 'interact', 'checkpoint', 'rollback', 'save_memory', 'memory_search', 'load_skill', 'web_search', 'web_read', 'http_request', 'init_project', 'apply_patch'];
  var SCHEMA_BUDGET = 14000; // bytes of serialized schemas per request

  function schemaBytes(s) { return JSON.stringify(s).length; }
  function stemLight(w) {
    if (w.length > 4) w = w.replace(/(ing|ed)$/, '');
    if (w.length > 3) w = w.replace(/e$/, '');
    return w;
  }
  function pickSchemas(userText, schemas, usage, budget) {
    budget = budget || SCHEMA_BUDGET;
    var byName = {};
    schemas.forEach(function (s) { byName[s.function.name] = s; });
    var chosen = [], used = 0, chosenNames = {};
    function take(name) {
      var s = byName[name];
      if (!s || chosenNames[name]) return;
      var b = schemaBytes(s);
      if (used + b > budget && chosen.length) return;
      chosen.push(s); chosenNames[name] = 1; used += b;
    }
    CORE_TOOLS.forEach(take);
    /* rank the REST: usage telemetry first, then task-keyword overlap */
    var text = String(userText || '').toLowerCase();
    var textToks = {};
    (text.match(/[a-z0-9]+/g) || []).forEach(function (w) { textToks[stemLight(w)] = 1; });
    var rest = schemas.filter(function (s) { return !chosenNames[s.function.name]; }).map(function (s) {
      var name = s.function.name;
      var kw = 0;
      var toks = (name.replace(/_/g, ' ') + ' ' + (s.function.description || '')).toLowerCase().match(/[a-z0-9]+/g) || [];
      var seenT = {};
      toks.forEach(function (w) {
        w = stemLight(w);
        if (textToks[w] && !seenT[w]) { seenT[w] = 1; kw += w.length > 4 ? 2 : 1; }
      });
      return { name: name, s: s, score: ((usage && usage[name]) || 0) * 3 + kw };
    }).sort(function (a, b) { return b.score - a.score; });
    rest.forEach(function (r) { take(r.name); });
    /* never ship a request without the core minimum even if over budget:
       the core took precedence already — if the budget squeezed the CORE
       (huge schemas), drop non-core that fit before core failed: handled
       by take() ordering (core first). */
    return { schemas: chosen, used: used, total: schemas.length, omitted: schemas.length - chosen.length };
  }

  return { isContextError: isContextError, groupify: groupify, compactTranscript: compactTranscript, isParallelSafe: isParallelSafe, rgArgs: rgArgs, parseRg: parseRg, injectThreeMap: injectThreeMap, withBudget: withBudget, makeToolHealth: makeToolHealth, DEFAULT_BUDGETS: DEFAULT_BUDGETS, editLadder: editLadder, flatWs: flatWs, simScore: simScore, fuzzyBest: fuzzyBest, snapshotRun: snapshotRun, validRunState: validRunState, resumeBrief: resumeBrief, buildSotW: buildSotW, pickSchemas: pickSchemas };
});
