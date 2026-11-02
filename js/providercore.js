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
    if (jr.usage) ev.usage = normalizeUsage(jr.usage);
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

  /* normalizeUsage(u): any family's usage object → {in, out} + optional
     cached / reasoning token fields (attached ONLY when the source carries
     them — partial stream events stay partial so callers can merge). */
  function normalizeUsage(u) {
    if (!u) return null;
    var out = { in: u.prompt_tokens || u.input_tokens || u.promptTokenCount || 0,
                out: u.completion_tokens || u.output_tokens || u.candidatesTokenCount || 0 };
    var cached = (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) ||
                 u.cache_read_input_tokens || u.cachedContentTokenCount || 0;
    var reasoning = (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) ||
                    u.thoughtsTokenCount || 0;
    if (cached) out.cached = cached;
    if (reasoning) out.reasoning = reasoning;
    return out;
  }

  /* estimateTokens(text): the honest fallback when a provider omits usage —
     ~4 chars per token for code-heavy English (same heuristic util uses). */
  function estimateTokens(text) {
    return Math.ceil(String(text || '').length / 4);
  }

  /* --- TokenMeter: session-scoped context accounting. add(usage) per chat
     call; pressure() projects the NEXT request's input (last observed input
     + everything generated since — the transcript carries forward) against
     the context budget. This is the number the compaction engine consumes. */
  function createTokenMeter(opts) {
    opts = opts || {};
    var limit = opts.limit || 0;
    var stats = { calls: 0, in: 0, out: 0, cached: 0, reasoning: 0, peakIn: 0 };
    var lastIn = 0, outSince = 0;
    function add(u) {
      if (u) {
        stats.calls++;
        stats.in += u.in || 0;
        stats.out += u.out || 0;
        stats.cached += u.cached || 0;
        stats.reasoning += u.reasoning || 0;
        if ((u.in || 0) > stats.peakIn) stats.peakIn = u.in || 0;
        lastIn = u.in || lastIn;
        outSince = u.out || 0; /* the output just generated rides forward into the next input */
      }
      return stats;
    }
    function generated(tokens) { outSince += tokens || 0; } /* non-usage output */
    function pressure() {
      if (!limit) return 0;
      return Math.min(1, (lastIn + outSince) / limit);
    }
    function toJSON() { return { v: 1, limit: limit, stats: stats, lastIn: lastIn, outSince: outSince }; }
    function fromJSON(s) {
      if (!s || s.v !== 1) return;
      limit = s.limit || 0;
      Object.keys(stats).forEach(function (k) { stats[k] = (s.stats && s.stats[k]) || 0; });
      lastIn = s.lastIn || 0;
      outSince = s.outSince || 0;
    }
    return { add: add, generated: generated, pressure: pressure,
             stats: function () { return Object.assign({}, stats); },
             toJSON: toJSON, fromJSON: fromJSON };
  }

  /* =====================  FAMILY ADAPTERS (v2 block 2)  =====================
     Native protocols translated to/from the SAME normalized event shape the
     OpenAI path uses: {content, reasoning, toolCall[], finishReason, usage}.
     The agent loop never learns a second protocol — the kernel translates. */

  /* detectFamily(p): which protocol does this provider speak? Explicit
     p.family wins; then the well-known host names; else OpenAI-compatible
     (the default that already works everywhere). */
  function detectFamily(p) {
    if (p && p.family) return String(p.family);
    var b = String((p && p.base) || '');
    if (/anthropic/i.test(b)) return 'anthropic';
    if (/generativelanguage|gemini/i.test(b)) return 'gemini';
    return 'openai';
  }

  /* --- ANTHROPIC (Messages API, 2023-06-01) --- */
  var ANTHROPIC_STOP = { end_turn: 'stop', stop_sequence: 'stop', max_tokens: 'length', tool_use: 'tool_calls', refusal: 'stop' };

  /* mapMessagesToAnthropic(openaiMsgs) → {system, messages}: system content
     lifts out to the top-level param; assistant tool_calls become tool_use
     blocks; role:'tool' results become user tool_result blocks. */
  function mapMessagesToAnthropic(msgs) {
    var system = [], out = [];
    (msgs || []).forEach(function (m) {
      if (m.role === 'system') { system.push(m.content); return; }
      if (m.role === 'tool') {
        out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id || '', content: String(m.content == null ? '' : m.content) }] });
        return;
      }
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
        var blocks = [];
        if (m.content) blocks.push({ type: 'text', text: String(m.content) });
        m.tool_calls.forEach(function (tc) {
          var input = {};
          try { input = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
          blocks.push({ type: 'tool_use', id: tc.id || 'call_0', name: tc.function.name, input: input });
        });
        out.push({ role: 'assistant', content: blocks });
        return;
      }
      out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content == null ? '' : m.content) });
    });
    return { system: system.join('\n\n'), messages: out };
  }

  /* mapToolsToAnthropic: OpenAI {type:function, function:{name,description,
     parameters}} → native {name, description, input_schema}. */
  function mapToolsToAnthropic(tools) {
    return (tools || []).map(function (t) {
      var f = (t && t.function) || t;
      return { name: f.name, description: f.description || '', input_schema: f.parameters || { type: 'object', properties: {} } };
    });
  }

  /* parseAnthropicLine(line): one SSE data line → normalized event(s).
     Tool blocks emit OpenAI-SHAPED fragments (index-keyed) so ai.js's
     existing mergeToolCall accumulates them unchanged. */
  function parseAnthropicLine(line) {
    if (!line || line.indexOf('data:') !== 0) return null;
    var d = line.slice(5).trim();
    if (!d || d === '[DONE]') return null;
    var j;
    try { j = JSON.parse(d); } catch (e) { return null; }
    var type = j.type;
    if (type === 'content_block_delta' && j.delta) {
      if (j.delta.type === 'text_delta' && j.delta.text) return { content: j.delta.text };
      if (j.delta.type === 'thinking_delta' && j.delta.thinking) return { reasoning: j.delta.thinking };
      if (j.delta.type === 'input_json_delta' && j.delta.partial_json) {
        return { toolCall: [{ index: j.index || 0, function: { arguments: j.delta.partial_json } }] };
      }
      return null;
    }
    if (type === 'content_block_start' && j.content_block && j.content_block.type === 'tool_use') {
      return { toolCall: [{ index: j.index || 0, id: j.content_block.id || 'call_0', function: { name: j.content_block.name || '' } }] };
    }
    if (type === 'message_start' && j.message && j.message.usage) {
      return { usage: normalizeUsage(j.message.usage) };
    }
    if (type === 'message_delta') {
      var ev = {};
      if (j.delta && j.delta.stop_reason) ev.finishReason = ANTHROPIC_STOP[j.delta.stop_reason] || j.delta.stop_reason;
      if (j.usage && j.usage.output_tokens != null) ev.usage = { out: j.usage.output_tokens };
      return (ev.finishReason || ev.usage) ? ev : null;
    }
    return null; /* ping, message_stop, content_block_stop, unknown */
  }

  /* parseAnthropicResponse(j): the non-stream Messages reply → the same
     triple the OpenAI sync path produces. */
  function parseAnthropicResponse(j) {
    var content = '', reasoning = '', calls = [];
    ((j && j.content) || []).forEach(function (b) {
      if (b.type === 'text') content += b.text || '';
      else if (b.type === 'thinking') reasoning += b.thinking || '';
      else if (b.type === 'tool_use') {
        calls.push({ id: b.id || 'call_0', type: 'function', function: { name: b.name || '', arguments: JSON.stringify(b.input || {}) } });
      }
    });
    return {
      content: content,
      reasoning: reasoning,
      toolCalls: calls.length ? calls : null,
      finishReason: ANTHROPIC_STOP[(j && j.stop_reason)] || (j && j.stop_reason) || '',
      usage: normalizeUsage(j && j.usage)
    };
  }

  /* --- GEMINI (generativelanguage, v1beta generateContent) --- */
  var GEMINI_STOP = { STOP: 'stop', MAX_TOKENS: 'length', SAFETY: 'safety', RECITATION: 'safety', MALFORMED_FUNCTION_CALL: 'stop' };

  /* mapMessagesToGemini(openaiMsgs) → {systemInstruction, contents}: system
     lifts to systemInstruction; assistant → role 'model'; tool results need
     the function NAME (Gemini has no tool_call ids) — resolved by scanning
     the prior assistant tool_calls for the matching id. */
  function mapMessagesToGemini(msgs) {
    var sys = [], contents = [];
    (msgs || []).forEach(function (m) { if (m.role === 'system') sys.push(m.content); });
    (msgs || []).forEach(function (m) {
      if (m.role === 'system') return;
      if (m.role === 'tool') {
        var name = 'unknown';
        for (var i = contents.length - 1; i >= 0; i--) {
          var c = contents[i];
          if (c.role !== 'model' || !c.parts) continue;
          var hit = null;
          (c.parts || []).forEach(function (p) {
            if (p.functionCall && p.functionCall._id && p.functionCall._id === m.tool_call_id) hit = p.functionCall;
          });
          if (hit) { name = hit.name; break; }
        }
        contents.push({ role: 'user', parts: [{ functionResponse: { name: name, response: { result: String(m.content == null ? '' : m.content) } } }] });
        return;
      }
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
        var parts = [];
        if (m.content) parts.push({ text: String(m.content) });
        m.tool_calls.forEach(function (tc) {
          var args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
          parts.push({ functionCall: { _id: tc.id || 'call_0', name: tc.function.name, args: args } });
        });
        contents.push({ role: 'model', parts: parts });
        return;
      }
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content == null ? '' : m.content) }] });
    });
    /* strip the private _id markers before the body ships */
    contents.forEach(function (c) {
      (c.parts || []).forEach(function (p) { if (p.functionCall) delete p.functionCall._id; });
    });
    return { systemInstruction: sys.length ? { parts: [{ text: sys.join('\n\n') }] } : null, contents: contents };
  }

  /* mapToolsToGemini: OpenAI function tools → {functionDeclarations:[…]}. */
  function mapToolsToGemini(tools) {
    var decls = (tools || []).map(function (t) {
      var f = (t && t.function) || t;
      return { name: f.name, description: f.description || '', parameters: f.parameters || { type: 'object', properties: {} } };
    });
    return decls.length ? [{ functionDeclarations: decls }] : [];
  }

  /* parseGeminiLine(line): one SSE data line → normalized event. */
  function parseGeminiLine(line) {
    if (!line || line.indexOf('data:') !== 0) return null;
    var d = line.slice(5).trim();
    if (!d || d === '[DONE]') return null;
    var j;
    try { j = JSON.parse(d); } catch (e) { return null; }
    var cand = j.candidates && j.candidates[0];
    var ev = {};
    if (j.usageMetadata) {
      ev.usage = normalizeUsage(j.usageMetadata);
    }
    if (cand && cand.finishReason) ev.finishReason = GEMINI_STOP[cand.finishReason] || cand.finishReason.toLowerCase();
    if (cand && cand.content && cand.content.parts) {
      cand.content.parts.forEach(function (p) {
        if (p.text && !p.thought) ev.content = (ev.content || '') + p.text;
        else if (p.text && p.thought) ev.reasoning = (ev.reasoning || '') + p.text;
        if (p.functionCall) {
          if (!ev.toolCall) ev.toolCall = [];
          ev.toolCall.push({
            index: ev.toolCall.length,
            id: 'gfc-' + ev.toolCall.length,
            function: { name: p.functionCall.name || '', arguments: JSON.stringify(p.functionCall.args || {}) }
          });
        }
      });
    }
    return (ev.content || ev.reasoning || ev.toolCall || ev.finishReason || ev.usage) ? ev : null;
  }

  /* parseGeminiResponse(j): non-stream generateContent reply → triple. */
  function parseGeminiResponse(j) {
    var ev = parseGeminiLine('data: ' + JSON.stringify(j));
    if (!ev) return { content: '', reasoning: '', toolCalls: null, finishReason: '', usage: null };
    return {
      content: ev.content || '',
      reasoning: ev.reasoning || '',
      toolCalls: ev.toolCall ? cleanToolCalls(ev.toolCall) : null,
      finishReason: ev.finishReason || '',
      usage: ev.usage || null
    };
  }

  /* =====================  FAMILY DISPATCH (ai.js calls these)  ===================== */

  /* familyEndpoint(family, base, kind): kind 'chat' | 'models'. Bases are
     already normalized + gated by the caller (ai.js owns assertEndpointUrl). */
  function familyEndpoint(family, base, kind, model) {
    var b = String(base || '').replace(/\/+$/, '');
    if (family === 'anthropic') {
      var root = /\/v1$/.test(b) ? b : b + '/v1';
      return kind === 'chat' ? root + '/messages' : root + '/models';
    }
    if (family === 'gemini') {
      var g = /\/v1(beta)?$/.test(b) ? b : b + '/v1beta';
      if (kind === 'models') return g + '/models';
      return g + '/models/' + encodeURIComponent(model || '') + ':generateContent';
    }
    return kind === 'chat' ? b + '/chat/completions' : b + '/models';
  }
  /* streamEndpoint: gemini streams via :streamGenerateContent?alt=sse */
  function streamEndpoint(family, base, model) {
    if (family === 'gemini') {
      var g = String(base || '').replace(/\/+$/, '');
      if (!/\/v1(beta)?$/.test(g)) g += '/v1beta';
      return g + '/models/' + encodeURIComponent(model || '') + ':streamGenerateContent?alt=sse';
    }
    return familyEndpoint(family, base, 'chat', model);
  }

  /* familyHeaders: anthropic = x-api-key + version pin (NO bearer);
     gemini = x-goog-api-key; openai = bearer (unchanged). */
  function familyHeaders(family, p) {
    var k = keyFor(p) || '';
    if (family === 'anthropic') {
      return { 'Content-Type': 'application/json', 'x-api-key': k, 'anthropic-version': '2023-06-01' };
    }
    if (family === 'gemini') {
      return { 'Content-Type': 'application/json', 'x-goog-api-key': k };
    }
    var h = { 'Content-Type': 'application/json' };
    if (k) h['Authorization'] = 'Bearer ' + k;
    return h;
  }

  /* buildFamilyBody(family, opts, maxTok): maxTok is the BUDGET (tokens,
     already scaled) so the ladder can re-build with a doubled value. */
  function buildFamilyBody(family, opts, maxTok) {
    if (family === 'anthropic') {
      var mm = mapMessagesToAnthropic(opts.messages);
      var body = {
        model: opts.model,
        max_tokens: maxTok,
        messages: mm.messages,
        stream: !!opts.stream
      };
      /* prompt caching (opt-in via opts.cache): the SYSTEM prompt is the
         big static prefix — mark it + the tool set as ephemeral breakpoints
         (2 of the 4 allowed; the response reports cache_read savings). */
      if (mm.system) {
        body.system = opts.cache
          ? [{ type: 'text', text: mm.system, cache_control: { type: 'ephemeral' } }]
          : mm.system;
      }
      var tools = mapToolsToAnthropic(opts.tools);
      if (tools.length) {
        if (opts.cache && tools.length) tools[tools.length - 1].cache_control = { type: 'ephemeral' };
        body.tools = tools;
        body.tool_choice = { type: 'auto' };
      }
      return body;
    }
    if (family === 'gemini') {
      var gm = mapMessagesToGemini(opts.messages);
      var gbody = { contents: gm.contents, generationConfig: { maxOutputTokens: maxTok } };
      if (gm.systemInstruction) gbody.systemInstruction = gm.systemInstruction;
      var gtools = mapToolsToGemini(opts.tools);
      if (gtools.length) gbody.tools = gtools;
      return gbody;
    }
    var ob = buildBody(opts);
    ob.max_tokens = maxTok;
    return ob;
  }

  /* parseStreamLine(family, line): one SSE line → normalized event (null to
     skip). OpenAI keeps parseSseLine; families translate. */
  function parseStreamLine(family, line) {
    if (family === 'anthropic') return parseAnthropicLine(line);
    if (family === 'gemini') return parseGeminiLine(line);
    return parseSseLine(line);
  }

  /* parseFamilyResponse(family, j): non-stream reply → {content, reasoning,
     toolCalls, finishReason, usage}. */
  function parseFamilyResponse(family, j) {
    if (family === 'anthropic') return parseAnthropicResponse(j);
    if (family === 'gemini') return parseGeminiResponse(j);
    var m = (j && j.choices && j.choices[0] && j.choices[0].message) || {};
    var fin = (j && j.choices && j.choices[0] && j.choices[0].finish_reason) || '';
    return {
      content: m.content || '',
      reasoning: m.reasoning_content || m.reasoning || '',
      toolCalls: (m.tool_calls && m.tool_calls.length) ? cleanToolCalls(m.tool_calls.slice()) : null,
      finishReason: fin,
      usage: (j && j.usage) ? normalizeUsage(j.usage) : null
    };
  }

  /* buildProbeBody(family, model): the cheapest possible live ping. */
  function buildProbeBody(family, model) {
    if (family === 'anthropic') return { model: model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] };
    if (family === 'gemini') return { contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } };
    return { model: model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false };
  }

  /* familyModels(j): the /models reply → sorted id list (per family). */
  function familyModels(family, j) {
    if (family === 'gemini') {
      return ((j && j.models) || [])
        .filter(function (m) { return !(m.supportedGenerationMethods || []).length || m.supportedGenerationMethods.indexOf('generateContent') >= 0; })
        .map(function (m) { return String(m.name || '').replace(/^models\//, ''); })
        .filter(Boolean).sort();
    }
    return ((j && (j.data || j.models)) || []).map(function (m) { return m.id || m.name; }).filter(Boolean).sort();
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
    normalizeUsage: normalizeUsage, estimateTokens: estimateTokens,
    createTokenMeter: createTokenMeter,
    detectFamily: detectFamily,
    mapMessagesToAnthropic: mapMessagesToAnthropic,
    mapToolsToAnthropic: mapToolsToAnthropic,
    parseAnthropicLine: parseAnthropicLine,
    parseAnthropicResponse: parseAnthropicResponse,
    mapMessagesToGemini: mapMessagesToGemini,
    mapToolsToGemini: mapToolsToGemini,
    parseGeminiLine: parseGeminiLine,
    parseGeminiResponse: parseGeminiResponse,
    familyEndpoint: familyEndpoint,
    streamEndpoint: streamEndpoint,
    familyHeaders: familyHeaders,
    buildFamilyBody: buildFamilyBody,
    parseStreamLine: parseStreamLine,
    parseFamilyResponse: parseFamilyResponse,
    buildProbeBody: buildProbeBody,
    familyModels: familyModels
  };
});
