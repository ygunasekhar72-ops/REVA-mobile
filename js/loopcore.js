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

  return { isContextError: isContextError, groupify: groupify, compactTranscript: compactTranscript, isParallelSafe: isParallelSafe };
});
