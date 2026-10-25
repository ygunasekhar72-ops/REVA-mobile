/* Mono Harness — MCP (Model Context Protocol) client, Streamable HTTP transport.
   Performs a real JSON-RPC handshake: initialize → notifications/initialized →
   tools/list. Tool *execution* is not available in the browser sandbox. */
(function () {
  var PROTOCOL = '2025-03-26';

  function baseUrl(u) { return (u || '').replace(/\/+$/, ''); }

  function post(base, body, sessionId) {
    var h = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    };
    if (sessionId) h['Mcp-Session-Id'] = sessionId;
    return fetch(base, { method: 'POST', headers: h, body: JSON.stringify(body) });
  }

  /* A streamable-HTTP server may answer with a single JSON body or an SSE
     stream — read either and return the JSON-RPC result for the given id. */
  async function readResult(res, id) {
    var ct = (res.headers.get('content-type') || '');
    if (ct.indexOf('text/event-stream') < 0) {
      var j = await res.json();
      if (j.error) throw new Error(j.error.message || ('RPC error ' + j.error.code));
      return j.result;
    }
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '', payload = null;
    while (true) {
      var r = await reader.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      var idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        var line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line.indexOf('data:') !== 0) continue;
        try {
          var msg = JSON.parse(line.slice(5).trim());
          if (msg.id === id) { payload = msg; }
        } catch (e) { /* partial or keepalive */ }
      }
      if (payload) break;
    }
    if (!payload) throw new Error('No response in SSE stream');
    if (payload.error) throw new Error(payload.error.message || ('RPC error ' + payload.error.code));
    return payload.result;
  }

  /* Probe a server: returns { tools: [{name, description}] } or throws. */
  async function probe(server) {
    var base = baseUrl(server.url);
    var init = await post(base, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: PROTOCOL, capabilities: {},
        clientInfo: { name: 'reva', version: '1.0.0' }
      }
    });
    if (!init.ok && init.status !== 202) {
      throw new Error('HTTP ' + init.status + ' during initialize');
    }
    var sid = init.headers.get('mcp-session-id') || '';
    var result = await readResult(init, 1);

    try { // notification — servers may ignore it, so tolerate failures
      await post(base, { jsonrpc: '2.0', method: 'notifications/initialized' }, sid);
    } catch (e) {}

    var toolsRes = await post(base, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, sid);
    if (!toolsRes.ok && toolsRes.status !== 202) {
      throw new Error('HTTP ' + toolsRes.status + ' during tools/list');
    }
    var tools = (await readResult(toolsRes, 2)).tools || [];
    return { serverInfo: result && result.serverInfo, tools: tools };
  }

  window.MCP = { probe: probe };
})();
