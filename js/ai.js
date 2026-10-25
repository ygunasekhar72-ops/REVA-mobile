/* Mono Harness — AI client for custom OpenAI-compatible providers */
(function () {
  function headers(p) {
    var h = { 'Content-Type': 'application/json' };
    if (p.key) h['Authorization'] = 'Bearer ' + p.key;
    return h;
  }
  function baseUrl(p) {
    return (p.base || '').replace(/\/+$/, '');
  }

  /* --- offline demo provider: streams a canned, helpful reply --- */
  function echoStream(text, onDelta, signal) {
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
        if (signal && signal.aborted) return resolve('');
        if (i >= words.length) return resolve(reply);
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

  /* --- chat completion, streaming or not --- */
  async function chat(opts) {
    var p = opts.provider, msgs = opts.messages;
    var onDelta = opts.onDelta || function () {};
    var signal = opts.signal;

    if (p.type === 'echo') {
      var lastUser = '';
      for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') { lastUser = msgs[i].content; break; }
      return echoStream(lastUser, onDelta, signal);
    }

    var body = {
      model: opts.model,
      messages: msgs,
      stream: !!opts.stream,
      max_tokens: (opts.maxTokens || 16) * 1024
    };

    var res = await fetch(baseUrl(p) + '/chat/completions', {
      method: 'POST', headers: headers(p), body: JSON.stringify(body), signal: signal
    });

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
      var content = (j.choices && j.choices[0] && (j.choices[0].message || {}).content) || '';
      onDelta(content);
      return content;
    }

    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '', full = '';
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
          var piece = jr.choices && jr.choices[0] && jr.choices[0].delta && jr.choices[0].delta.content;
          if (piece) { full += piece; onDelta(piece); }
        } catch (e) { /* keepalive or partial json — ignore */ }
      }
    }
    return full;
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

  window.AI = { chat: chat, listModels: listModels, friendlyError: friendlyError };
})();
