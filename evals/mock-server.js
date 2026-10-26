/* Mock OpenAI-compatible + MCP server for testing Mono Harness. */
const http = require('http');

const state = { lastChat: null, lastHook: null, hooks: [], r429: 0 };

function cors(res, req) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Mcp-Session-Id');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

const MODEL_ID = 'mock-mini';

function replyFor(messages) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const sys = messages.find((m) => m.role === 'system');
  return 'MOCKOK — you said: "' + (last ? last.content.slice(0, 80) : '') + '". ' +
    (sys && sys.content.includes('MOCKMARKER') ? 'Marker seen. ' : '') +
    'System prompt length: ' + (sys ? sys.content.length : 0) + '.\n\n' +
    '```js\nconst mock = true;\n```';
}

const server = http.createServer(async (req, res) => {
  cors(res, req);
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // ---- OpenAI-compatible ----
  if (url.pathname === '/v1/models') {
    return json(res, 200, { data: [{ id: MODEL_ID }, { id: 'mock-pro' }, { id: 'mock-agent' }, { id: 'mock-shell' }, { id: 'mock-linux' }] });
  }
  if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
    const body = await readBody(req);
    state.lastChat = body;
    // rate-limit simulator: mock-429 rejects the first two calls, then serves
    if (body.model === 'mock-429' && ++state.r429 <= 2) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' });
      return res.end(JSON.stringify({ error: { message: 'Too Many Requests' } }));
    }
    // deterministic agent model: round 1 streams a tool call whose
    // arguments arrive in fragments; the round after the tool result answers.
    if (body.model === 'mock-agent') {
      const hadToolResult = body.messages.some(m => m.role === 'tool');
      const args = JSON.stringify({ path: 'demo.txt', content: 'x'.repeat(12000) });
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
        let pending = [];
        if (!hadToolResult) {
          pending.push({ choices: [{ delta: { reasoning_content: 'Planning the file contents carefully now. ' } }] });
          pending.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'write_file', arguments: '' } }] } }] });
          for (let p = 0; p < args.length; p += 2000) {
            pending.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(p, p + 2000) } }] } }] });
          }
        } else {
          pending.push({ choices: [{ delta: { reasoning_content: 'Verifying the write succeeded. ' } }] });
          pending.push({ choices: [{ delta: { content: 'File written — demo complete.' } }] });
        }
        let n = 0;
        const tick = () => {
          if (n >= pending.length) { res.write('data: [DONE]\n\n'); return res.end(); }
          send(pending[n++]);
          setTimeout(tick, 60);
        };
        return tick();
      }
      if (!hadToolResult) {
        return json(res, 200, { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'write_file', arguments: args } }] } }] });
      }
      return json(res, 200, { choices: [{ message: { role: 'assistant', reasoning_content: 'verify', content: 'File written — demo complete.' } }] });
    }
    // shell-agent model: calls shell_exec on the device, reports result.
    // The user's text picks the command: 'fail' → a failing command.
    if (body.model === 'mock-shell') {
      const hadToolResult = body.messages.some(m => m.role === 'tool');
      const userMsg = (body.messages.filter(m => m.role === 'user').pop() || {}).content || '';
      const cmd = /fail/i.test(userMsg) ? 'false' : 'uname -a';
      const finish = (payload) => {
        if (!body.stream) return json(res, 200, { choices: [{ message: Object.assign({ role: 'assistant' }, payload) }] });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const parts = payload.reasoning_content
          ? [{ choices: [{ delta: { reasoning_content: payload.reasoning_content } }] }, { choices: [{ delta: { content: payload.content || '' } }] }]
          : [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-s1', type: 'function', function: { name: 'shell_exec', arguments: JSON.stringify({ command: cmd }) } }] } }] }];
        let n = 0;
        const tick = () => {
          if (n >= parts.length) { res.write('data: [DONE]\n\n'); return res.end(); }
          res.write('data: ' + JSON.stringify(parts[n++]) + '\n\n');
          setTimeout(tick, 50);
        };
        return tick();
      };
      if (!hadToolResult) return finish({ content: '', tool_calls: [{ id: 'call-s1', type: 'function', function: { name: 'shell_exec', arguments: JSON.stringify({ command: cmd }) } }] });
      const toolRes = (body.messages.filter(m => m.role === 'tool').pop() || {}).content || '';
      const ok = /\[exit 0\]/.test(toolRes);
      return finish({ reasoning_content: 'reading the command output', content: ok ? 'Command succeeded on the device. Kernel: ' + toolRes.split('\\n')[0] : 'The command FAILED — ' + toolRes.trim() });
    }
    // REVA Linux session model: successive shell_exec rounds must share one
    // guest session — cd /host persists, then pwd proves it, then a guest
    // file read proves the Alpine rootfs. Verifies cwd persistence + guest
    // path semantics of the v1.3.0 agent shell.
    if (body.model === 'mock-linux') {
      const toolMsgs = body.messages.filter(m => m.role === 'tool');
      const rounds = ['cd /host', 'pwd', 'cat /etc/alpine-release'];
      const emit = (payload) => {
        if (!body.stream) return json(res, 200, { choices: [{ message: Object.assign({ role: 'assistant' }, payload) }] });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const parts = payload.content !== undefined
          ? [{ choices: [{ delta: { content: payload.content } }] }]
          : [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-l' + toolMsgs.length, type: 'function', function: { name: 'shell_exec', arguments: JSON.stringify({ command: payload.cmd }) } }] } }] }];
        let n = 0;
        const tick = () => {
          if (n >= parts.length) { res.write('data: [DONE]\n\n'); return res.end(); }
          res.write('data: ' + JSON.stringify(parts[n++]) + '\n\n');
          setTimeout(tick, 50);
        };
        return tick();
      };
      if (toolMsgs.length < rounds.length) return emit({ cmd: rounds[toolMsgs.length] });
      return emit({ content: 'REVA Linux session verified: ' + toolMsgs.map(m => (m.content || '').trim().split('\n').slice(-2).join(' / ').slice(0, 60)).join(' || ') });
    }
    // empty-reply simulator: returns bare empty completions (stream = one
    // empty delta), to exercise the client's recovery ladder
    if (body.model === 'mock-empty') {
      const empty = { choices: [{ message: { role: 'assistant', content: '' } }] };
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '' } }] }) + '\n\n');
        return res.end('data: [DONE]\n\n');
      }
      return json(res, 200, empty);
    }
    const text = replyFor(body.messages || []);
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const words = text.split(/(\s+)/);
      let i = 0;
      const tick = () => {
        if (i >= words.length) {
          res.write('data: [DONE]\n\n');
          return res.end();
        }
        const chunk = words.slice(i, i + 2).join('');
        i += 2;
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: chunk } }] }) + '\n\n');
        setTimeout(tick, 10);
      };
      return tick();
    }
    return json(res, 200, { choices: [{ message: { role: 'assistant', content: text } }] });
  }

  // ---- MCP streamable HTTP ----
  if (url.pathname === '/mcp' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.method === 'initialize') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': 'mock-session-123'
      });
      return res.end(JSON.stringify({
        jsonrpc: '2.0', id: body.id,
        result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'mock-mcp', version: '1.0.0' } }
      }));
    }
    if (body.method === 'notifications/initialized') {
      res.writeHead(202); return res.end();
    }
    if (body.method === 'tools/list') {
      return json(res, 200, {
        jsonrpc: '2.0', id: body.id,
        result: { tools: [
          { name: 'mock_echo', description: 'Echoes text back' },
          { name: 'mock_time', description: 'Returns the current time' }
        ] }
      });
    }
    return json(res, 200, { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
  }

  // ---- webhook receiver ----
  if (url.pathname === '/hook' && req.method === 'POST') {
    const body = await readBody(req);
    state.lastHook = body;
    state.hooks.push(body);
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/last') return json(res, 200, state.lastChat);
  if (url.pathname === '/last-hook') return json(res, 200, state.lastHook);
  if (url.pathname === '/hooks') return json(res, 200, state.hooks);
  res.writeHead(404); res.end('not found');
});

server.listen(8123, '127.0.0.1', () => console.log('mock server on http://127.0.0.1:8123'));
