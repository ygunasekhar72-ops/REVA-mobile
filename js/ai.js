/* Mono Harness — AI client for custom OpenAI-compatible providers.
   chat() resolves { content, reasoning, toolCalls } — reasoning carries the
   model's thinking stream (NVIDIA reasoning_content / gpt-oss reasoning) and
   toolCalls the accumulated OpenAI-style function calls. */
(function () {
  /* MULTI-KEY ENDURANCE: a provider accepts several API keys separated by
     commas/newlines. keyFor() returns the active one (runtime cursor), so a
     long run survives per-key quota walls by rotating to the next key. */
  function keyList(p) {
    return String(p.key || '').split(/[,\n;]+/).map(function (k) { return k.trim(); }).filter(Boolean);
  }
  function keyFor(p) {
    var list = keyList(p);
    if (!list.length) return '';
    return list[Math.min(p._keyIdx || 0, list.length - 1)];
  }
  function rotateKey(p) {
    var list = keyList(p);
    var next = (p._keyIdx || 0) + 1;
    if (next >= list.length) { p._keyIdx = 0; return false; }
    p._keyIdx = next;
    return true;
  }
  function isQuotaError(e) {
    return /http 429|http 402|quota|insufficient|billing|limit reached|monthly limit|credit/i.test(String((e && e.message) || e || ''));
  }
  /* transient = worth an automatic retry on the SAME provider: server blips
     and network drops should never end a long run on their own */
  function isTransientError(e) {
    var m = String((e && e.message) || e || '');
    if (isQuotaError(m)) return false;
    return /http 5\d\d|failed to fetch|networkerror|network error|timeout|timed out|socket|load failed|econn/i.test(m);
  }
  function headers(p) {
    var h = { 'Content-Type': 'application/json' };
    var k = keyFor(p);
    if (k) h['Authorization'] = 'Bearer ' + k;
    return h;
  }
  function baseUrl(p) {
    var u = (p.base || '').replace(/\/+$/, '');
    // users often paste the full endpoint — normalize to the API root
    u = u.replace(/\/chat\/completions$/, '').replace(/\/models$/, '');
    // scheme/charset/credential sanity (local providers like Ollama are allowed)
    u = H.assertEndpointUrl(u);
    return u;
  }

  /* --- offline demo provider: streams a canned, helpful reply --- */
  function echoResult(text, onDelta, onReasoning, signal) {
    var reply = 'You are on the **Echo (offline demo)** provider — no network is used.\n\n' +
      'You said: "' + (text.length > 160 ? text.slice(0, 160) + '…' : text) + '"\n\n' +
      'To talk to a real model:\n' +
      '1. Open Settings → Model → Provider\n' +
      '2. Pick a preset (OpenAI, OpenRouter, Groq, Ollama, LM Studio) or add a custom base URL\n' +
      '3. Paste your API key and press "Fetch models"\n\n' +
      'Any OpenAI-compatible endpoint works, including local ones.';
    var words = reply.split(/(\s+)/);
    var i = 0;
    return new Promise(function (resolve, reject) {
      function step() {
        if (signal && signal.aborted) return resolve({ content: reply, reasoning: '', toolCalls: null });
        if (i >= words.length) return resolve({ content: reply, reasoning: '', toolCalls: null });
        var chunk = words.slice(i, i + 2).join('');
        i += 2;
        onDelta(chunk);
        setTimeout(step, 14);
      }
      setTimeout(step, 120);
    });
  }

  /* --- list models from {base}/models --- */
  async function listModels(p) {
    if (p.type === 'echo') return p.models.slice();
    var res = await fetchWithRetry(baseUrl(p) + '/models', { headers: headers(p) });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text().catch(function () { return ''; })).slice(0, 160));
    var j = await res.json();
    var arr = (j.data || j.models || []).map(function (m) { return m.id || m.name; }).filter(Boolean);
    return arr.sort();
  }

  /* transient rate limits (429/503) are common on shared endpoints — back off
     and retry instead of surfacing an error to the user */
  function sleep(ms, signal) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(resolve, ms);
      if (signal) signal.addEventListener('abort', function () { clearTimeout(t); resolve(); }, { once: true });
    });
  }
  async function fetchWithRetry(url, init, opts) {
    var retries = (opts && opts.retries) != null ? opts.retries : 3;
    /* request cap: generous (big generations stream for minutes), but bounded */
    var TIMEOUT_MS = 300000;
    for (var attempt = 0; ; attempt++) {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { } }, TIMEOUT_MS);
      var onOuterAbort = function () { try { ctrl.abort(); } catch (e) { } };
      if (init.signal) {
        if (init.signal.aborted) onOuterAbort();
        else init.signal.addEventListener('abort', onOuterAbort);
      }
      var res;
      try {
        res = await fetch(url, Object.assign({}, init, { signal: ctrl.signal }));
      } catch (e) {
        clearTimeout(timer);
        if (init.signal && init.signal.aborted) throw e; // user stop — propagate
        if (attempt >= retries) throw e;
        await sleep(1000 * Math.pow(2, attempt) + attempt * 250, init.signal);
        continue;
      }
      clearTimeout(timer);
      /* 429/503 — NVIDIA free-tier windows are ~per-minute. The ONLY thing
         that works is WAITING OUT THE WINDOW: honor Retry-After, else wait
         a full minute, up to 3 times (≈3 min patience). Fast ladders just
         hammer the limit and surface "(empty reply)" errors. */
      if (res.status === 429 || res.status === 503) {
        if (attempt >= 3) return res;
        var ra = parseInt(res.headers.get('retry-after') || '0', 10);
        var waitMs = ra > 0 ? ra * 1000 : 60000;
        await sleep(waitMs, init.signal);
        continue;
      }
      return res;
    }
  }

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
    if (opts.effort && !opts.provider.noEffort) {
      body.reasoning_effort = ({ Low: 'low', High: 'medium', Max: 'high' })[opts.effort] || 'medium';
    }
    return body;
  }

  /* accumulate streaming tool_call fragments by index */
  function mergeToolCall(acc, tc) {
    var i = tc.index || 0;
    acc[i] = acc[i] || { id: '', type: 'function', function: { name: '', arguments: '' } };
    if (tc.id) acc[i].id = tc.id;
    if (tc.function) {
      if (tc.function.name) acc[i].function.name += tc.function.name;
      if (tc.function.arguments) acc[i].function.arguments += tc.function.arguments;
    }
    return acc;
  }
  function cleanToolCalls(acc) {
    var arr = acc.filter(Boolean).map(function (t) {
      try { JSON.parse(t.function.arguments); } catch (e) { t.function.arguments = '{}'; }
      return t;
    });
    return arr.length ? arr : null;
  }

  /* some providers (e.g. minimax) leak tool calls as TEXT inside content
     instead of the tool_calls field. Detect and lift them out. */
  function liftTextToolCalls(content, acc) {
    if (!content) return null;
    // minimax's textual protocol often has no closing tag — match to one or EOL
    var re = /(?:\]<\][a-z0-9._-]*\[>\[)?<tool_call>\s*(?:name=["']([\w.-]+)["']\s*>?)?\s*([\s\S]*?)(?:<\/tool_call>|$)/gi;
    var m, calls = [], out = content, idx = 0;
    while ((m = re.exec(content)) !== null) {
      if (m[0].indexOf('<tool_call>') < 0) continue;
      var name = m[1], argsRaw = m[2].trim();
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
    if (!calls.length) return null;
    if (acc) acc.out = out.trim();
    return calls;
  }

  /* --- chat completion, streaming or not --- */
  async function chat(opts) {
    var p = opts.provider, msgs = opts.messages;
    var onDelta = opts.onDelta || function () {};
    var onReasoning = opts.onReasoning || function () {};
    var signal = opts.signal;

    if (p.type === 'echo') {
      var lastUser = '';
      for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') { lastUser = msgs[i].content; break; }
      return echoResult(lastUser, onDelta, onReasoning, signal);
    }

    /* BUDGET-AWARE REQUEST LOOP — the permanent "(empty reply)" fix.
       Reasoning models spend max_tokens on thinking FIRST; when the budget
       runs out the response ends with finish_reason:'length' and NO
       content/tool_calls. opencode/continue avoid this by never capping
       low (models.dev gives GLM ~98K output) and handling length-finish.
       We default to 64K and auto-double up to 256K on length-finish. */
    var maxTok = Math.max(32, opts.maxTokens || 64) * 1024;
    var result = null;
    /* linked controller: the user's stop signal AND the stream watchdog both
       land here; user stop rethrows, watchdog stall yields an empty result */
    var ctrl0 = ('AbortController' in window) ? new AbortController() : null;
    var linkAbort = function () { try { ctrl0.abort(); } catch (eL) { } };
    if (signal) { if (signal.aborted) linkAbort(); else signal.addEventListener('abort', linkAbort); }
    var fetchSignal = ctrl0 ? ctrl0.signal : signal;
    for (var budgetTry = 0; budgetTry < 3 && !result; budgetTry++) {
      var body0 = buildBody(opts);
      body0.max_tokens = maxTok;
      if (budgetTry > 0 && opts.onReasoning) {
        onReasoning('\n\n[token budget raised to ' + Math.round(maxTok / 1024) + 'K — the previous round ended mid-reasoning]\n\n');
      }
      var res = await fetchWithRetry(baseUrl(p) + '/chat/completions', {
        method: 'POST', headers: headers(p), body: JSON.stringify(body0), signal: fetchSignal
      });
      // if this endpoint rejects the reasoning_effort parameter, remember and retry without it
      if (!res.ok && res.status === 400 && opts.effort && !opts.provider.noEffort) {
        var errText = await res.text().catch(function () { return ''; });
        if (/reasoning_effort|unrecognized|unexpected|unknown field|unsupported/i.test(errText)) {
          opts.provider.noEffort = true;
          var body2 = buildBody(opts);
          body2.max_tokens = maxTok;
          delete body2.reasoning_effort;
          res = await fetchWithRetry(baseUrl(p) + '/chat/completions', {
            method: 'POST', headers: headers(p), body: JSON.stringify(body2), signal: fetchSignal
          });
        }
      }

      if (!res.ok) {
        var t = await res.text().catch(function () { return ''; });
        var hint = '';
        if (res.status === 401 || res.status === 403) hint = ' — check your API key';
        if (res.status === 404) hint = ' — check the base URL and model name';
        if (res.status === 429) hint = ' — rate limit or quota reached';
        throw new Error('HTTP ' + res.status + hint + (t ? '\n' + t.slice(0, 220) : ''));
      }

      if (!opts.stream) {
        var j = await res.json();
        var m = (j.choices && j.choices[0] && j.choices[0].message) || {};
        var fin0 = (j.choices && j.choices[0] && j.choices[0].finish_reason) || '';
        var content0 = m.content || '';
        var reas0 = m.reasoning_content || m.reasoning || '';
        if (reas0) onReasoning(reas0);
        var lifted0 = liftTextToolCalls(content0);
        if (lifted0) content0 = content0.replace(/(?:\]<\][a-z0-9._-]*\[>\[)?<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim();
        if (content0) onDelta(content0);
        var tc0 = (m.tool_calls && m.tool_calls.length) ? cleanToolCalls(m.tool_calls.slice()) : null;
        if (!tc0 && lifted0) tc0 = lifted0;
        if (opts.onToolCall && tc0) {
          for (var q = 0; q < tc0.length; q++) opts.onToolCall(tc0[q].function.name, (tc0[q].function.arguments || '').length);
        }
        if (fin0 === 'length' && !content0 && !tc0 && budgetTry < 2) { maxTok *= 2; continue; }
        var u0 = j.usage || null;
        result = { content: content0, reasoning: reas0, toolCalls: tc0, finishReason: fin0, usage: u0 ? { in: u0.prompt_tokens || 0, out: u0.completion_tokens || 0 } : null };
      } else {
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = '', full = '', reasoning = '', tcAcc = [];
        var finS = '';
        var streamUsage = null;
        /* stream inactivity watchdog: some servers keep the SSE open after
           finish (or wedge mid-body). If no bytes arrive for 75s, abort the
           read and return an empty result — the caller's empty-reply ladder
           retries. A user stop aborts the same controller and rethrows. */
        var lastByte = Date.now();
        var wdog = null;
        var armWdog = function () {
          if (wdog) clearInterval(wdog);
          wdog = setInterval(function () {
            if (Date.now() - lastByte > 75000) { try { ctrl0.abort(); } catch (eW) { } }
          }, 15000);
        };
        var readLoop = true;
        while (readLoop) {
          var r;
          try { r = await reader.read(); } catch (eRead) {
            clearInterval(wdog);
            if (signal && signal.aborted) throw eRead; // user stop — propagate
            break; // watchdog stall → empty result → caller retries
          }
          clearInterval(wdog);
          if (r.done) break;
          lastByte = Date.now();
          armWdog();
          buf += dec.decode(r.value, { stream: true });
          var idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            var line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line.startsWith('data:')) continue;
            var d = line.slice(5).trim();
            if (d === '[DONE]') continue;
            try {
              var jr = JSON.parse(d);
              var ch0 = jr.choices && jr.choices[0];
              var delta = ch0 && ch0.delta;
              if (ch0 && ch0.finish_reason) finS = ch0.finish_reason;
              if (jr.usage) streamUsage = jr.usage;
              if (!delta) continue;
              var piece = delta.content;
              if (piece) { full += piece; onDelta(piece); }
              var reas = delta.reasoning_content || delta.reasoning;
              if (reas) { reasoning += reas; onReasoning(reas); }
              if (delta.tool_calls) {
                for (var k = 0; k < delta.tool_calls.length; k++) {
                  mergeToolCall(tcAcc, delta.tool_calls[k]);
                  var t2 = delta.tool_calls[k];
                  var ix = t2.index || 0;
                  if (opts.onToolCall && tcAcc[ix]) {
                    opts.onToolCall(tcAcc[ix].function.name, (tcAcc[ix].function.arguments || '').length);
                  }
                }
              }
            } catch (e) { /* keepalive or partial json — ignore */ }
          }
        }
        if (wdog) clearInterval(wdog);
        var acc2 = {};
        var lifted = liftTextToolCalls(full, acc2);
        if (lifted) {
          // re-render the content without the textual protocol block
          full = acc2.out || '';
          if (opts.onDeltaClean && full) opts.onDeltaClean(full);
        }
        if (finS === 'length' && !full && !tcAcc.length && budgetTry < 2) { maxTok *= 2; continue; }
        result = { content: full, reasoning: reasoning, toolCalls: cleanToolCalls(tcAcc) || lifted, finishReason: finS, usage: streamUsage ? { in: streamUsage.prompt_tokens || 0, out: streamUsage.completion_tokens || 0 } : null };
      }
    }
    return result || { content: '', reasoning: '', toolCalls: null };
  }

  /* --- model verification: does this model actually serve chat on this endpoint? --- */
  async function probeModel(p, model) {
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var to = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : null;
    try {
      var res = await fetchWithRetry(baseUrl(p) + '/chat/completions', {
        method: 'POST', headers: headers(p),
        body: JSON.stringify({ model: model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
        signal: ctrl ? ctrl.signal : undefined
      }, { retries: 1 });
      if (res.ok) return 'ok';
      if (res.status === 404) return 'dead';
      var t = await res.text().catch(function () { return ''; });
      if (/not found|does not exist|no such model|unknown model|invalid model/i.test(t)) return 'dead';
      return 'unknown'; // 429/5xx/timeout — not the model's fault
    } catch (e) {
      return 'unknown';
    } finally {
      if (to) clearTimeout(to);
    }
  }

  function friendlyError(e) {
    var m = String(e && e.message || e);
    if (m.indexOf('Failed to fetch') >= 0 || e instanceof TypeError) {
      return 'Network / CORS error — the endpoint refused this request.\n' +
        '• Local servers: enable CORS (Ollama: OLLAMA_ORIGINS=*, LM Studio: enable CORS in settings)\n' +
        '• Remote APIs: check the base URL, and that the provider allows browser requests';
    }
    return m;
  }

  window.AI = { chat: chat, listModels: listModels, probeModel: probeModel, friendlyError: friendlyError, keyList: keyList, rotateKey: rotateKey, isQuotaError: isQuotaError, isTransientError: isTransientError };
})();
