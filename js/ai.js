/* Mono Harness — AI client for custom OpenAI-compatible providers.
   chat() resolves { content, reasoning, toolCalls } — reasoning carries the
   model's thinking stream (NVIDIA reasoning_content / gpt-oss reasoning) and
   toolCalls the accumulated OpenAI-style function calls. */
(function () {
  function headers(p) {
    var h = { 'Content-Type': 'application/json' };
    if (p.key) h['Authorization'] = 'Bearer ' + p.key;
    return h;
  }
  function baseUrl(p) {
    var u = (p.base || '').replace(/\/+$/, '');
    // users often paste the full endpoint — normalize to the API root
    u = u.replace(/\/chat\/completions$/, '').replace(/\/models$/, '');
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
    var res = await fetch(baseUrl(p) + '/models', { headers: headers(p) });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text().catch(function () { return ''; })).slice(0, 160));
    var j = await res.json();
    var arr = (j.data || j.models || []).map(function (m) { return m.id || m.name; }).filter(Boolean);
    return arr.sort();
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

    var res;
    try {
      res = await fetch(baseUrl(p) + '/chat/completions', {
        method: 'POST', headers: headers(p), body: JSON.stringify(buildBody(opts)), signal: signal
      });
    } catch (e) {
      if (signal && signal.aborted) throw e;
      throw e;
    }
    // if this endpoint rejects the reasoning_effort parameter, remember and retry without it
    if (!res.ok && res.status === 400 && opts.effort && !opts.provider.noEffort) {
      var errText = await res.text().catch(function () { return ''; });
      if (/reasoning_effort|unrecognized|unexpected|unknown field|unsupported/i.test(errText)) {
        opts.provider.noEffort = true;
        var body2 = buildBody(opts);
        delete body2.reasoning_effort;
        res = await fetch(baseUrl(p) + '/chat/completions', {
          method: 'POST', headers: headers(p), body: JSON.stringify(body2), signal: signal
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
      var content0 = m.content || '';
      if (content0) onDelta(content0);
      var reas0 = m.reasoning_content || m.reasoning || '';
      if (reas0) onReasoning(reas0);
      return { content: content0, reasoning: reas0, toolCalls: (m.tool_calls && m.tool_calls.length) ? cleanToolCalls(m.tool_calls.slice()) : null };
    }

    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '', full = '', reasoning = '', tcAcc = [];
    while (true) {
      var r = await reader.read();
      if (r.done) break;
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
          var delta = jr.choices && jr.choices[0] && jr.choices[0].delta;
          if (!delta) continue;
          var piece = delta.content;
          if (piece) { full += piece; onDelta(piece); }
          var reas = delta.reasoning_content || delta.reasoning;
          if (reas) { reasoning += reas; onReasoning(reas); }
          if (delta.tool_calls) {
            for (var k = 0; k < delta.tool_calls.length; k++) mergeToolCall(tcAcc, delta.tool_calls[k]);
          }
        } catch (e) { /* keepalive or partial json — ignore */ }
      }
    }
    return { content: full, reasoning: reasoning, toolCalls: cleanToolCalls(tcAcc) };
  }

  /* --- model verification: does this model actually serve chat on this endpoint? --- */
  async function probeModel(p, model) {
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var to = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : null;
    try {
      var res = await fetch(baseUrl(p) + '/chat/completions', {
        method: 'POST', headers: headers(p),
        body: JSON.stringify({ model: model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
        signal: ctrl ? ctrl.signal : undefined
      });
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

  window.AI = { chat: chat, listModels: listModels, probeModel: probeModel, friendlyError: friendlyError };
})();
