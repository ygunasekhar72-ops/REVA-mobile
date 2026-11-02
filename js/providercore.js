/* REVA — Provider Core (the pure kernel of the AI client layer).
   Everything here is DETERMINISTIC and node-testable: multi-key rotation,
   error classification, URL normalization, SSE delta parsing, tool-call
   fragment merging, textual-tool-call lifting, request-body building, and
   the retry/budget DECISION functions. The side-ful parts (fetch, timers,
   AbortController) stay in ai.js — they call into this kernel. This split
   is the v2 seam: per-provider-family adapters and token accounting will
   layer here without touching the app surface.
   Pure UMD: identical code in node tests and the WebView. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PROVIDERCORE = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  /* --- multi-key endurance: a provider accepts several API keys separated
     by commas/newlines/semicolons; the cursor lives on the provider object
     (p._keyIdx) so a long run survives per-key quota walls --- */
  function keyList(p) {
    return String((p && p.key) || '').split(/[,\n;]+/).map(function (k) { return k.trim(); }).filter(Boolean);
  }
  function keyFor(p) {
    var list = keyList(p);
    if (!list.length) return '';
    return list[Math.min((p && p._keyIdx) || 0, list.length - 1)];
  }
  function rotateKey(p) {
    var list = keyList(p);
    var next = ((p && p._keyIdx) || 0) + 1;
    if (next >= list.length) { if (p) p._keyIdx = 0; return false; }
    if (p) p._keyIdx = next;
    return true;
  }

  /* --- error classification (the failure ladder's routing decisions) --- */
  var QUOTA_RE = /http 429|http 402|quota|insufficient|billing|limit reached|monthly limit|credit/i;
  var TRANSIENT_RE = /http 5\d\d|failed to fetch|networkerror|network error|timeout|timed out|socket|load failed|econn/i;
  function isQuotaError(e) {
    return QUOTA_RE.test(String((e && e.message) || e || ''));
  }
  function isTransientError(e) {
    var m = String((e && e.message) || e || '');
    if (isQuotaError(m)) return false;
    return TRANSIENT_RE.test(m);
  }

  /* classifyHttp(status, bodyText): the status → human hint map that chat()
     and probeModel() both need. kind drives the ladder: 'auth' | 'notfound'
     | 'rate' | 'reject' (bad request) | 'server' | 'client'. */
  function classifyHttp(status, bodyText) {
    var t = String(bodyText || '');
    var kind = (status >= 500) ? 'server' : (status >= 400) ? 'client' : 'ok';
    var hint = '';
    if (status === 401 || status === 403) { kind = 'auth'; hint = ' — check your API key'; }
    else if (status === 404) { kind = 'notfound'; hint = ' — check the base URL and model name'; }
    else if (status === 429) { kind = 'rate'; hint = ' — rate limit or quota reached'; }
    else if (status === 400) { kind = 'reject'; }
    else if (status === 402) { kind = 'quota'; hint = ' — billing required'; }
    return { kind: kind, hint: hint, body: t.slice(0, 220) };
  }

  /* normalizeBaseUrl(u, assertUrl): users paste full endpoints — normalize to
     the API root, then run the harness's URL sanity gate (injected so this
     stays pure). */
  function normalizeBaseUrl(u, assertUrl) {
    var x = String(u || '').replace(/\/+$/, '');
    x = x.replace(/\/chat\/completions$/, '').replace(/\/models$/, '');
    return assertUrl ? assertUrl(x) : x;
  }

  /* retryDecision(status, attempt): the fetchWithRetry policy as a pure
     decision. 429/503 rate windows cannot be fixed by fast retries — the
     ONLY thing that works is waiting out the window (Retry-After honored,
     else a full minute), up to 3 waits (~3 min patience). Anything else is
     returned to the caller as-is (null = no wait). */
  function retryDecision(status, attempt, retryAfterSec) {
    if (status !== 429 && status !== 503) return null;
    if (attempt >= 3) return null;
    var waitMs = (parseInt(retryAfterSec || '0', 10) > 0) ? parseInt(retryAfterSec, 10) * 1000 : 60000;
    return { wait: waitMs };
  }

  /* budgetLadder(maxTok, finishReason, hasContent, hasToolCalls, budgetTry):
     reasoning models spend max_tokens on thinking FIRST — a length-finish
     with NO content and NO tool calls means the budget starved. Auto-double
     (32K → 256K max) instead of surfacing an empty reply. */
  function budgetLadder(maxTok, finishReason, hasContent, hasToolCalls, budgetTry) {
    var starved = finishReason === 'length' && !hasContent && !hasToolCalls;
    if (starved && budgetTry < 2) return { double: true, next: maxTok * 2 };
    return { double: false, next: maxTok };
  }

  /* --- request body building --- */
  function buildBody(opts) {
    var body = {
      model: opts.model,
      messages: opts.messages,
      stream: !!opts.stream,
      max_tokens: (opts.maxTokens || 16) * 1024
    };
    if (opts.tools && opts.tools.length) {
      body.tools = opts.tools;
      body.tool_choice = 'auto';
    }
    if (opts.effort && !(opts.provider && opts.provider.noEffort)) {
      body.reasoning_effort = ({ Low: 'low', High: 'medium', Max: 'high' })[opts.effort] || 'medium';
    }
    return body;
  }

  /* isEffortRejection(errText): the 400 body wording that means "this
     endpoint does not accept reasoning_effort" — the noEffort learning gate. */
  function isEffortRejection(errText) {
    return /reasoning_effort|unrecognized|unexpected|unknown field|unsupported/i.test(String(errText || ''));
  }

  /* --- tool-call fragment accumulation (streaming deltas merge by index) --- */
  function mergeToolCall(acc, tc) {
    var i = (tc && tc.index) || 0;
    acc[i] = acc[i] || { id: '', type: 'function', function: { name: '', arguments: '' } };
    if (tc && tc.id) acc[i].id = tc.id;
    if (tc && tc.function) {
      if (tc.function.name) acc[i].function.name += tc.function.name;
      if (tc.function.arguments) acc[i].function.arguments += tc.function.arguments;
    }
    return acc;
  }
  function cleanToolCalls(acc) {
    var arr = (acc || []).filter(Boolean).map(function (t) {
      try { JSON.parse(t.function.arguments); } catch (e) { t.function.arguments = '{}'; }
      return t;
    });
    return arr.length ? arr : null;
  }

  /* parseSseLine(line): the OpenAI-compatible SSE event parser — the
     provider-compatibility heart. Returns an event object or null:
     { content, reasoning, toolCall, finishReason, usage }. Tolerates
     partial/keepalive junk by design (bad JSON = null, never a throw). */
  function parseSseLine(line) {
    if (!line || line.indexOf('data:') !== 0) return null;
    var d = line.slice(5).trim();
    if (d === '[DONE]') return null;
    var jr;
    try { jr = JSON.parse(d); } catch (e) { return null; }
    var ev = {};
    var ch0 = jr.choices && jr.choices[0];
    if (ch0 && ch0.finish_reason) ev.finishReason = ch0.finish_reason;
    if (jr.usage) ev.usage = { in: jr.usage.prompt_tokens || 0, out: jr.usage.completion_tokens || 0 };
    var delta = ch0 && ch0.delta;
    if (!delta) return (ev.finishReason || ev.usage) ? ev : null;
    if (delta.content) ev.content = delta.content;
    var reas = delta.reasoning_content || delta.reasoning;
    if (reas) ev.reasoning = reas;
    if (delta.tool_calls && delta.tool_calls.length) ev.toolCall = delta.tool_calls;
    return (ev.content || ev.reasoning || ev.toolCall || ev.finishReason || ev.usage) ? ev : null;
  }

  /* --- textual tool-call lifting: some providers (minimax) leak tool calls
     as TEXT inside content. Detect, parse, strip. matchAll only (scanner
     law) and a backreference for the quote char (no quotes in the literal). */
  function liftTextToolCalls(content) {
    if (!content) return null;
    var calls = [], out = content, idx = 0;
    var re = /(?:\]<\][a-z0-9._-]*\[>\[)?<tool_call>\s*(?:name=(.)([\w.-]+)\1\s*>?)?\s*([\s\S]*?)(?:<\/tool_call>|$)/gi;
    var matches = content.matchAll(re);
    for (var step = matches.next(); !step.done; step = matches.next()) {
      var m = step.value;
      if (m[0].indexOf('<tool_call>') < 0) continue;
      var name = m[2], argsRaw = (m[3] || '').trim();
      if (!argsRaw) continue;
      if (!name) {
        try {
          var j = JSON.parse(argsRaw);
          name = j.name || j.function || j.function_name;
          if (j.arguments && typeof j.arguments !== 'string') argsRaw = JSON.stringify(j.arguments);
          if (typeof j.arguments === 'string') argsRaw = j.arguments;
        } catch (e) {}
      }
      if (!name) continue;
      try { JSON.parse(argsRaw); } catch (e) { argsRaw = '{}'; }
      calls.push({ id: 'call-txt-' + (idx++), type: 'function', function: { name: name, arguments: argsRaw } });
      out = out.split(m[0]).join('');
    }
    return calls.length ? { calls: calls, content: out.trim() } : null;
  }
  /* stripTextToolCalls(content): remove the textual protocol blocks from
     content when the caller consumed tool calls from another field. */
  function stripTextToolCalls(content) {
    return String(content || '').replace(/(?:\]<\][a-z0-9._-]*\[>\[)?<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi, '').trim();
  }

  /* normalizeUsage(j): OpenAI usage (sync) or stream usage → {in, out}. */
  function normalizeUsage(u) {
    if (!u) return null;
    return { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 };
  }

  return {
    keyList: keyList, keyFor: keyFor, rotateKey: rotateKey,
    isQuotaError: isQuotaError, isTransientError: isTransientError,
    classifyHttp: classifyHttp, normalizeBaseUrl: normalizeBaseUrl,
    retryDecision: retryDecision, budgetLadder: budgetLadder,
    buildBody: buildBody, isEffortRejection: isEffortRejection,
    mergeToolCall: mergeToolCall, cleanToolCalls: cleanToolCalls,
    parseSseLine: parseSseLine,
    liftTextToolCalls: liftTextToolCalls, stripTextToolCalls: stripTextToolCalls,
    normalizeUsage: normalizeUsage
  };
});
