/* REVA agent evals — promptfoo-style scenario assertions, no framework.
   Mirrors the harness agent-loop rules (bounded iters, empty-reply ladder,
   tool execution, Guard gating) against the mock provider, and measures
   task success, tool-call counts and latency per scenario.

   Run:  node evals/agent-eval.js
   Needs the mock server:  node evals/mock-server.js  (port 8123)          */
const http = require('http');

const BASE = 'http://127.0.0.1:8123/v1';
const results = [];

function chat(body) {
  return new Promise(function (resolve, reject) {
    const payload = JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port: 8123, path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 30000 }, function (res) {
      let t = '';
      res.on('data', c => t += c);
      res.on('end', () => resolve({ status: res.statusCode, body: t }));
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload); req.end();
  });
}

function parseToolCalls(text) {
  try { const j = JSON.parse(text); return (j.choices && j.choices[0] && j.choices[0].message) || {}; } catch (e) { return {}; }
}

/* mock tool implementations mirroring the harness behavior */
const TOOLS = {
  shell_exec: a => a.command === 'uname -a' ? 'Linux reva x86_64 [exit 0]' : (a.command === 'false' ? '[exit 1]' : '[exit 0]'),
  write_file: a => 'Wrote ' + (a.path || '') + ' (' + String(a.content || '').length + ' chars)',
  read_file: a => 'file content'
};

/* one agent round following harness rules: bounded iters, tool execution,
   empty-reply ladder (1 re-sync + 2 retries + 2 nudges) */
async function agentLoop(model, userMsg) {
  const msgs = [{ role: 'user', content: userMsg }];
  const t0 = Date.now();
  let toolCalls = 0, iters = 0, nsTried = false, streamRetries = 0, nudges = 0, res = null, pendingRes = null, failed = null;
  const MAX_ITERS = 14;
  while (true) {
    iters++;
    if (iters > MAX_ITERS) { failed = 'max iters'; break; }
    if (pendingRes) { res = pendingRes; pendingRes = null; }
    else {
      try {
        const r = await chat({ model, stream: false, max_tokens: 500, messages: msgs });
        const m = parseToolCalls(r.body);
        res = { content: m.content || '', tool_calls: Array.isArray(m.tool_calls) ? m.tool_calls : null, raw: r.body.slice(0, 200) };
      } catch (e) { failed = String(e.message || e); break; }
    }
    if (res.tool_calls && res.tool_calls.length) {
      msgs.push({ role: 'assistant', content: res.content || '', tool_calls: res.tool_calls });
      for (const tc of res.tool_calls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { }
        const fn = TOOLS[tc.function.name];
        const out = fn ? fn(args) : 'unknown tool';
        toolCalls++;
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: String(out) });
      }
      continue;
    }
    if (!(res.content || '').trim()) {
      if (!nsTried) { nsTried = true; pendingRes = await (async () => { const r = await chat({ model, stream: false, max_tokens: 500, messages: msgs }); const m = parseToolCalls(r.body); return { content: m.content || '', tool_calls: m.tool_calls || null }; })(); continue; }
      if (streamRetries < 2) { streamRetries++; continue; }
      if (nudges < 2) { nudges++; msgs.push({ role: 'user', content: 'Your last reply was empty. Continue.' }); continue; }
      break;
    }
    break;
  }
  return { iters, toolCalls, ms: Date.now() - t0, content: (res && res.content) || '', failed };
}

function record(name, pass, detail, ms) {
  results.push({ name, pass, detail, ms });
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + '  (' + ms + 'ms)  ' + detail);
}

async function main() {
  // health check
  await new Promise(function (res, rej) {
    http.get('http://127.0.0.1:8123/v1/models', function (r) { res(); }).on('error', rej);
  });

  // 1. tool selection + task success: mock-shell runs shell_exec and reports
  {
    const t0 = Date.now();
    const r = await agentLoop('mock-shell', 'check the device');
    record('shell task: correct tool + success report',
      r.toolCalls === 1 && /succeeded/i.test(r.content), 'toolCalls=' + r.toolCalls, Date.now() - t0);
  }

  // 2. failure honesty: failing command is reported as failed, not invented
  {
    const t0 = Date.now();
    const r = await agentLoop('mock-shell', 'make it fail');
    record('failure honesty: exit 1 reported as failure',
      r.toolCalls === 1 && /failed/i.test(r.content), 'toolCalls=' + r.toolCalls, Date.now() - t0);
  }

  // 3. fragmented tool arguments arrive complete (12KB write)
  {
    const t0 = Date.now();
    const r = await agentLoop('mock-agent', 'write demo.txt');
    record('fragmented args: write completes with full payload',
      r.toolCalls === 1 && r.content.indexOf('File written') >= 0, 'toolCalls=' + r.toolCalls, Date.now() - t0);
  }

  // 4. empty-reply ladder: bounded recovery, then honest stop (no hang)
  {
    const t0 = Date.now();
    const r = await agentLoop('mock-empty', 'hello');
    record('empty-reply ladder: bounded, no hang, honest stop',
      !r.failed && r.iters >= 5 && !r.content, 'iters=' + r.iters, Date.now() - t0);
  }

  // 5. Guard gating (source-level assertion): shell_exec must be excluded in
  //    Guard mode by the app's own filter — static regression check
  {
    const fs = require('fs');
    const app = fs.readFileSync(require('path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
    const m = app.match(/if \(mode === 'Guard'\) return \[([^\]]*)\]/);
    const guarded = m && m[1].indexOf('shell_exec') >= 0;
    const mcpExcluded = app.indexOf("n.indexOf('mcp_') === 0) return mode !== 'Guard'") >= 0;
    record('Guard gating: shell_exec + MCP tools excluded in Guard mode', !!guarded && mcpExcluded, 'static check', 0);
  }

  // 6. discipline prompt present (superpowers/mini-swe pattern regression)
  {
    const fs = require('fs');
    const app = fs.readFileSync(require('path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
    record('discipline protocol: todo_write plan + verify-before-success in prompt',
      app.indexOf('todo_write first') >= 0 && app.indexOf('Never claim success without evidence') >= 0, 'static check', 0);
  }

  // 7. filesystem containment + edit_file (filesystem server parity)
  {
    const fs = require('fs');
    const tools = fs.readFileSync(require('path').join(__dirname, '..', 'js', 'tools.js'), 'utf8');
    const containment = tools.indexOf("out[0] !== 'workspace'") >= 0;
    const editFile = tools.indexOf('edit_file: function') >= 0 && tools.indexOf('oldString not found') >= 0;
    const offsetRead = tools.indexOf("a.offset") >= 0;
    const createDir = tools.indexOf('create_directory: function') >= 0;
    record('filesystem: containment clamp + edit_file + offset reads + create_directory',
      containment && editFile && offsetRead && createDir, 'static check', 0);
  }

  // 8. web SSRF guard (fetch-server hardening)
  {
    const fs = require('fs');
    const web = fs.readFileSync(require('path').join(__dirname, '..', 'js', 'web.js'), 'utf8');
    const guard = web.indexOf('isPrivateTarget') >= 0 && web.indexOf('BLOCKED_HOST') >= 0 && web.indexOf('BLOCKED_SUFFIX') >= 0;
    record('web: SSRF guard blocks loopback/private/link-local in agent retrieval', guard, 'static check', 0);
  }

  // 9. memory: delete_memory + dedupe-update present (memory-server parity)
  {
    const fs = require('fs');
    const tools = fs.readFileSync(require('path').join(__dirname, '..', 'js', 'tools.js'), 'utf8');
    record('memory: delete_memory tool + duplicate-title update present',
      tools.indexOf('delete_memory: function') >= 0 && tools.indexOf('Updated memory') >= 0, 'static check', 0);
  }

  // 10. MCP progressive discovery cap
  {
    const fs = require('fs');
    const app = fs.readFileSync(require('path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
    record('MCP: progressive tool discovery (15-per-server cap in schemas)',
      app.indexOf('sorted.slice(0, 15)') >= 0, 'static check', 0);
  }

  const pass = results.filter(r => r.pass).length;
  console.log('\n' + pass + '/' + results.length + ' scenarios passed');
  require('fs').writeFileSync(require('path').join(__dirname, 'results.json'), JSON.stringify({ date: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  process.exit(pass === results.length ? 0 : 1);
}

main().catch(function (e) { console.error('EVAL RUNNER ERROR:', e.message, '\n', e.stack && e.stack.split('\n').slice(0, 6).join('\n')); process.exit(2); });
