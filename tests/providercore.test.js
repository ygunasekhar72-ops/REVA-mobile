/* Unit test: the Provider Core kernel (js/providercore.js).
   Keys, error classification, URL normalization, HTTP hints, retry + budget
   decisions, body building, SSE delta parsing, tool-call merge/lift. */
'use strict';
const assert = require('assert');
const PC = require('../js/providercore.js');

(async () => {
  // 1. keyList: comma/newline/semicolon splitting, empties dropped
  assert.deepStrictEqual(PC.keyList({ key: 'a, b\nc; d' }), ['a', 'b', 'c', 'd'], 'multi-separator split');
  assert.deepStrictEqual(PC.keyList({ key: '  ' }), [], 'blank key = empty list');
  assert.deepStrictEqual(PC.keyList(null), [], 'null provider safe');

  // 2. keyFor cursor + rotateKey wrap
  const p = { key: 'k1,k2,k3', _keyIdx: 1 };
  assert.strictEqual(PC.keyFor(p), 'k2', 'cursor honored');
  assert.ok(PC.rotateKey(p), 'rotate to next');
  assert.strictEqual(PC.keyFor(p), 'k3', 'now k3');
  assert.ok(!PC.rotateKey(p), 'wrap returns false');
  assert.strictEqual(PC.keyFor(p), 'k1', 'cursor reset to 0');
  assert.strictEqual(PC.keyFor({ key: '' }), '', 'no keys = empty key');

  // 3. error classification: quota vs transient are disjoint ladders
  assert.ok(PC.isQuotaError({ message: 'HTTP 429 — monthly limit reached' }), 'quota wording');
  assert.ok(PC.isQuotaError('insufficient credits'), 'quota string form');
  assert.ok(!PC.isTransientError({ message: 'HTTP 429' }), 'quota is NOT transient');
  assert.ok(PC.isTransientError({ message: 'Failed to fetch' }), 'network blip transient');
  assert.ok(PC.isTransientError('HTTP 503'), '5xx transient');
  assert.ok(!PC.isTransientError({ message: 'HTTP 401' }), 'auth is neither');

  // 4. classifyHttp: status → kind + hint + bounded body
  assert.strictEqual(PC.classifyHttp(401).kind, 'auth', 'auth kind');
  assert.ok(/API key/.test(PC.classifyHttp(401).hint), 'auth hint');
  assert.strictEqual(PC.classifyHttp(404).kind, 'notfound', 'notfound kind');
  assert.strictEqual(PC.classifyHttp(429).kind, 'rate', 'rate kind');
  assert.strictEqual(PC.classifyHttp(400).kind, 'reject', 'reject kind');
  assert.strictEqual(PC.classifyHttp(502).kind, 'server', 'server kind');
  assert.strictEqual(PC.classifyHttp(200).kind, 'ok', 'ok kind');
  assert.strictEqual(PC.classifyHttp(500, 'x'.repeat(999)).body.length, 220, 'body bounded');

  // 5. normalizeBaseUrl: full endpoints + trailing slashes → API root
  assert.strictEqual(PC.normalizeBaseUrl('https://api.x.com/v1/chat/completions///'), 'https://api.x.com/v1', 'endpoint + slashes');
  assert.strictEqual(PC.normalizeBaseUrl('https://api.x.com/v1/models'), 'https://api.x.com/v1', 'models endpoint');
  assert.strictEqual(PC.normalizeBaseUrl('https://api.x.com/v1/'), 'https://api.x.com/v1', 'plain root');
  const seen = [];
  assert.strictEqual(PC.normalizeBaseUrl('https://q/v1', u => { seen.push(u); return 'GATED'; }), 'GATED', 'assert fn injected');
  assert.deepStrictEqual(seen, ['https://q/v1'], 'gate received normalized URL');

  // 6. retryDecision: rate-window patience, Retry-After honored
  assert.deepStrictEqual(PC.retryDecision(429, 0, '30'), { wait: 30000 }, 'Retry-After wins');
  assert.deepStrictEqual(PC.retryDecision(429, 1, ''), { wait: 60000 }, 'no header = full minute');
  assert.strictEqual(PC.retryDecision(429, 3), null, 'give up after 3 waits');
  assert.deepStrictEqual(PC.retryDecision(503, 2, '5'), { wait: 5000 }, '503 same ladder, header honored');
  assert.deepStrictEqual(PC.retryDecision(503, 0), { wait: 60000 }, '503 waits too');
  assert.strictEqual(PC.retryDecision(500, 0), null, '5xx returns to caller as-is');

  // 7. budgetLadder: length-finish starvation doubles, capped
  assert.deepStrictEqual(PC.budgetLadder(32768, 'length', false, false, 0), { double: true, next: 65536 }, 'starved → double');
  assert.deepStrictEqual(PC.budgetLadder(131072, 'length', false, false, 1), { double: true, next: 262144 }, 'second doubling');
  assert.strictEqual(PC.budgetLadder(262144, 'length', false, false, 2).double, false, 'cap after 2 tries');
  assert.strictEqual(PC.budgetLadder(32768, 'length', true, false, 0).double, false, 'content present = not starved');
  assert.strictEqual(PC.budgetLadder(32768, 'length', false, true, 0).double, false, 'tool calls = not starved');
  assert.strictEqual(PC.budgetLadder(32768, 'stop', false, false, 0).double, false, 'other finish = not starved');

  // 8. buildBody: tools, effort mapping, noEffort learning
  const bb = PC.buildBody({ model: 'm', messages: [], stream: true, maxTokens: 64, tools: [{ t: 1 }], effort: 'Max', provider: {} });
  assert.strictEqual(bb.max_tokens, 65536, 'maxTokens scaled to tokens');
  assert.strictEqual(bb.tool_choice, 'auto', 'tool choice');
  assert.strictEqual(bb.reasoning_effort, 'high', 'effort mapped');
  assert.strictEqual(PC.buildBody({ model: 'm', messages: [], provider: { noEffort: true }, effort: 'High' }).reasoning_effort, undefined, 'noEffort learned flag suppresses');
  assert.ok(!PC.buildBody({ model: 'm', messages: [] }).tools, 'no tools field when empty');

  // 9. isEffortRejection: the 400 learning gate
  assert.ok(PC.isEffortRejection('Unrecognized request argument: reasoning_effort'), 'openai-style wording');
  assert.ok(!PC.isEffortRejection('Invalid API key'), 'unrelated 400 not matched');

  // 10. mergeToolCall + cleanToolCalls: fragments fuse by index
  const acc = [];
  PC.mergeToolCall(acc, { index: 0, id: 'c1', function: { name: 'rea', arguments: '{"pa' } });
  PC.mergeToolCall(acc, { index: 0, function: { name: 'd_file', arguments: 'th":"x"}' } });
  PC.mergeToolCall(acc, { index: 2, function: { name: 'z', arguments: '{}' } });
  const cleaned = PC.cleanToolCalls(acc);
  assert.strictEqual(cleaned[0].id, 'c1', 'id kept');
  assert.strictEqual(cleaned[0].function.name, 'read_file', 'name fused');
  assert.strictEqual(cleaned[0].function.arguments, '{"path":"x"}', 'args fused');
  assert.strictEqual(cleaned[1].function.name, 'z', 'sparse index preserved');
  PC.mergeToolCall([], { index: 9, function: { arguments: 'not-json' } });
  assert.strictEqual(PC.cleanToolCalls([{ function: { name: 'a', arguments: 'oops' } }])[0].function.arguments, '{}', 'broken args sanitized');
  assert.strictEqual(PC.cleanToolCalls([]), null, 'empty = null');

  // 11. parseSseLine: the compatibility heart
  assert.deepStrictEqual(PC.parseSseLine('data: {"choices":[{"delta":{"content":"hi"}}]}'), { content: 'hi' }, 'content delta');
  assert.deepStrictEqual(PC.parseSseLine('data: {"choices":[{"delta":{"reasoning_content":"think"}}]}'), { reasoning: 'think' }, 'reasoning_content');
  assert.deepStrictEqual(PC.parseSseLine('data: {"choices":[{"delta":{"reasoning":"alt"}}]}'), { reasoning: 'alt' }, 'reasoning alt field');
  assert.deepStrictEqual(PC.parseSseLine('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}'), { finishReason: 'stop' }, 'finish only');
  const tcEv = PC.parseSseLine('data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"name":"f"}}]}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}');
  assert.strictEqual(tcEv.toolCall.length, 1, 'tool call event');
  assert.deepStrictEqual(tcEv.usage, { in: 5, out: 2 }, 'usage normalized');
  assert.strictEqual(PC.parseSseLine('data: [DONE]'), null, 'DONE ignored');
  assert.strictEqual(PC.parseSseLine('data: {"broken'), null, 'partial JSON tolerated');
  assert.strictEqual(PC.parseSseLine(': keepalive'), null, 'non-data line ignored');
  assert.strictEqual(PC.parseSseLine('data: {"choices":[{"delta":{}}]}'), null, 'empty delta = no event');

  // 12. liftTextToolCalls + strip: the minimax textual protocol
  const lift = PC.liftTextToolCalls('pre <tool_call>name="ws" >{"path":"a"}</tool_call> post');
  assert.strictEqual(lift.calls.length, 1, 'call lifted');
  assert.strictEqual(lift.calls[0].function.name, 'ws', 'name from attribute');
  assert.strictEqual(lift.calls[0].function.arguments, '{"path":"a"}', 'args JSON');
  assert.strictEqual(lift.content, 'pre  post', 'content stripped');
  const lift2 = PC.liftTextToolCalls('<tool_call>{"name":"other","arguments":{"k":1}}');
  assert.strictEqual(lift2.calls[0].function.name, 'other', 'name from JSON body');
  assert.strictEqual(lift2.calls[0].function.arguments, '{"k":1}', 'object args stringified');
  assert.strictEqual(lift2.content, '', 'unclosed block stripped to end');
  assert.strictEqual(PC.liftTextToolCalls('no protocol here'), null, 'no calls = null');
  assert.strictEqual(PC.stripTextToolCalls('a<tool_call>x</tool_call>b'), 'ab', 'strip inline');
  assert.strictEqual(PC.stripTextToolCalls('a<tool_call>unclosed'), 'a', 'strip unclosed to end (stream-path parity)');

  // 13. normalizeUsage
  assert.deepStrictEqual(PC.normalizeUsage({ prompt_tokens: 10, completion_tokens: 3 }), { in: 10, out: 3 }, 'openai usage');
  assert.strictEqual(PC.normalizeUsage(null), null, 'no usage = null');

  // 14. detectFamily: explicit > host-name > openai default
  assert.strictEqual(PC.detectFamily({ base: 'https://api.anthropic.com/v1' }), 'anthropic', 'anthropic host');
  assert.strictEqual(PC.detectFamily({ base: 'https://generativelanguage.googleapis.com' }), 'gemini', 'gemini host');
  assert.strictEqual(PC.detectFamily({ base: 'https://api.x.com/v1' }), 'openai', 'default openai');
  assert.strictEqual(PC.detectFamily({ family: 'gemini', base: 'https://x' }), 'gemini', 'explicit wins');

  // 15. Anthropic message/tool mapping (the OpenAI transcript → Messages API)
  const am = PC.mapMessagesToAnthropic([
    { role: 'system', content: 'be terse' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'checking', tool_calls: [{ id: 't1', function: { name: 'rf', arguments: '{"p":1}' } }] },
    { role: 'tool', tool_call_id: 't1', content: 'file data' }
  ]);
  assert.strictEqual(am.system, 'be terse', 'system lifted to top-level');
  assert.deepStrictEqual(am.messages[0], { role: 'user', content: 'hi' }, 'plain user');
  assert.deepStrictEqual(am.messages[1].content[1], { type: 'tool_use', id: 't1', name: 'rf', input: { p: 1 } }, 'tool_calls → tool_use blocks');
  assert.deepStrictEqual(am.messages[2].content[0], { type: 'tool_result', tool_use_id: 't1', content: 'file data' }, 'tool role → user tool_result');
  assert.deepStrictEqual(PC.mapToolsToAnthropic([{ type: 'function', function: { name: 'rf', description: 'd', parameters: { type: 'object' } } }]),
    [{ name: 'rf', description: 'd', input_schema: { type: 'object' } }], 'tools → input_schema');

  // 16. Anthropic SSE + response parsing (real wire shapes)
  assert.deepStrictEqual(PC.parseAnthropicLine('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"he"}}'), { content: 'he' }, 'text delta');
  assert.deepStrictEqual(PC.parseAnthropicLine('data: {"type":"content_block_delta","index":2,"delta":{"type":"thinking_delta","thinking":"hmm"}}'), { reasoning: 'hmm' }, 'thinking delta');
  assert.deepStrictEqual(PC.parseAnthropicLine('data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"rf"}}'),
    { toolCall: [{ index: 1, id: 'tu_1', function: { name: 'rf' } }] }, 'tool block start (mergeToolCall-compatible)');
  assert.deepStrictEqual(PC.parseAnthropicLine('data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\":"}}'),
    { toolCall: [{ index: 1, function: { arguments: '{"a":' } }] }, 'args fragment (index-keyed)');
  assert.deepStrictEqual(PC.parseAnthropicLine('data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":42}}'),
    { finishReason: 'tool_calls', usage: { out: 42 } }, 'stop_reason mapped + partial usage');
  assert.strictEqual(PC.parseAnthropicLine('data: {"type":"ping"}'), null, 'ping ignored');
  assert.deepStrictEqual(PC.parseAnthropicLine('data: {"type":"message_start","message":{"usage":{"input_tokens":100}}}'), { usage: { in: 100, out: 0 } }, 'message_start usage');
  const ar = PC.parseAnthropicResponse({ content: [{ type: 'text', text: 'a' }, { type: 'tool_use', id: 'tu', name: 'rf', input: { x: 1 } }], stop_reason: 'max_tokens', usage: { input_tokens: 9, output_tokens: 3 } });
  assert.strictEqual(ar.content, 'a', 'response text');
  assert.strictEqual(ar.toolCalls[0].function.arguments, '{"x":1}', 'tool_use → openai shape');
  assert.strictEqual(ar.finishReason, 'length', 'stop_reason mapped');
  assert.deepStrictEqual(ar.usage, { in: 9, out: 3 }, 'usage');

  // 17. Gemini mapping + SSE + response
  const gm = PC.mapMessagesToGemini([
    { role: 'system', content: 'be terse' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', tool_calls: [{ id: 't1', function: { name: 'rf', arguments: '{"p":1}' } }] },
    { role: 'tool', tool_call_id: 't1', content: 'file data' }
  ]);
  assert.strictEqual(gm.systemInstruction.parts[0].text, 'be terse', 'systemInstruction');
  assert.deepStrictEqual(gm.contents[1].parts[0].functionCall, { name: 'rf', args: { p: 1 } }, 'tool_calls → functionCall (no _id leaks)');
  assert.strictEqual(gm.contents[2].parts[0].functionResponse.name, 'rf', 'tool result name RESOLVED from the prior call id');
  assert.deepStrictEqual(PC.mapToolsToGemini([{ type: 'function', function: { name: 'rf', description: 'd', parameters: { type: 'object' } } }]),
    [{ functionDeclarations: [{ name: 'rf', description: 'd', parameters: { type: 'object' } }] }], 'tools → functionDeclarations');
  const gWire = { candidates: [{ content: { parts: [{ text: 'he' }, { functionCall: { name: 'rf', args: { p: 1 } } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 } };
  const gEv = PC.parseGeminiLine('data: ' + JSON.stringify(gWire));
  assert.strictEqual(gEv.content, 'he', 'gemini text part');
  assert.strictEqual(gEv.toolCall[0].function.name, 'rf', 'gemini functionCall → openai fragment');
  assert.strictEqual(gEv.toolCall[0].function.arguments, '{"p":1}', 'args stringified');
  assert.strictEqual(gEv.finishReason, 'stop', 'STOP mapped');
  assert.deepStrictEqual(gEv.usage, { in: 7, out: 2 }, 'usageMetadata');
  const gr = PC.parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'a' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3 } });
  assert.strictEqual(gr.finishReason, 'length', 'MAX_TOKENS mapped');
  assert.strictEqual(gr.content, 'a', 'response text');

  // 18. Family dispatch surface: endpoints, headers, bodies, probe, models
  assert.strictEqual(PC.familyEndpoint('anthropic', 'https://api.anthropic.com', 'chat'), 'https://api.anthropic.com/v1/messages', 'v1 injected');
  assert.strictEqual(PC.familyEndpoint('anthropic', 'https://api.anthropic.com/v1/', 'chat'), 'https://api.anthropic.com/v1/messages', 'v1 respected + slash trimmed');
  assert.strictEqual(PC.streamEndpoint('gemini', 'https://generativelanguage.googleapis.com', 'gemini-2.0-flash'),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse', 'gemini stream endpoint');
  assert.strictEqual(PC.familyEndpoint('openai', 'https://api.x.com/v1', 'chat'), 'https://api.x.com/v1/chat/completions', 'openai unchanged');
  assert.deepStrictEqual(PC.familyHeaders('anthropic', { key: 'k' }), { 'Content-Type': 'application/json', 'x-api-key': 'k', 'anthropic-version': '2023-06-01' }, 'anthropic headers (no bearer)');
  assert.deepStrictEqual(PC.familyHeaders('gemini', { key: 'k' }), { 'Content-Type': 'application/json', 'x-goog-api-key': 'k' }, 'gemini header');
  assert.deepStrictEqual(PC.familyHeaders('openai', { key: 'k' }), { 'Content-Type': 'application/json', Authorization: 'Bearer k' }, 'openai header unchanged');
  const fab = PC.buildFamilyBody('anthropic', { model: 'claude-x', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], tools: [{ type: 'function', function: { name: 't', description: '', parameters: {} } }], stream: true }, 65536);
  assert.strictEqual(fab.max_tokens, 65536, 'anthropic budget lands as max_tokens');
  assert.strictEqual(fab.system, 's', 'anthropic system param');
  assert.strictEqual(fab.tool_choice.type, 'auto', 'anthropic tool_choice');
  const fgb = PC.buildFamilyBody('gemini', { model: 'g', messages: [{ role: 'user', content: 'u' }] }, 4096);
  assert.deepStrictEqual(fgb.generationConfig, { maxOutputTokens: 4096 }, 'gemini budget in generationConfig');
  const fob = PC.buildFamilyBody('openai', { model: 'm', messages: [] }, 4096);
  assert.strictEqual(fob.max_tokens, 4096, 'openai budget unchanged');
  assert.deepStrictEqual(PC.buildProbeBody('anthropic', 'c1'), { model: 'c1', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }, 'anthropic probe (max_tokens REQUIRED)');
  assert.deepStrictEqual(PC.buildProbeBody('gemini', 'g1').generationConfig, { maxOutputTokens: 1 }, 'gemini probe');
  assert.deepStrictEqual(PC.familyModels('gemini', { models: [{ name: 'models/gemini-2', supportedGenerationMethods: ['generateContent'] }, { name: 'models/e', supportedGenerationMethods: ['embedContent'] }] }), ['gemini-2'], 'gemini models filtered');
  assert.deepStrictEqual(PC.familyModels('anthropic', { data: [{ id: 'claude-b' }, { id: 'claude-a' }] }), ['claude-a', 'claude-b'], 'anthropic models like openai');

  // 19. usage v2: cached/reasoning fields per family, attached only when present
  assert.deepStrictEqual(PC.normalizeUsage({ prompt_tokens: 10, completion_tokens: 3 }), { in: 10, out: 3 }, 'plain openai usage unchanged');
  assert.deepStrictEqual(PC.normalizeUsage({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 80 }, completion_tokens_details: { reasoning_tokens: 2 } }),
    { in: 100, out: 5, cached: 80, reasoning: 2 }, 'openai cached+reasoning details');
  assert.deepStrictEqual(PC.normalizeUsage({ input_tokens: 50, output_tokens: 4, cache_read_input_tokens: 40 }),
    { in: 50, out: 4, cached: 40 }, 'anthropic cache_read');
  assert.deepStrictEqual(PC.normalizeUsage({ promptTokenCount: 30, candidatesTokenCount: 2, thoughtsTokenCount: 9, cachedContentTokenCount: 20 }),
    { in: 30, out: 2, cached: 20, reasoning: 9 }, 'gemini thoughts+cached');
  const msw = PC.parseAnthropicLine('data: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":90}}}');
  assert.strictEqual(msw.usage.cached, 90, 'anthropic stream start carries cache');
  const gsse = PC.parseGeminiLine('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'x' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1, thoughtsTokenCount: 3 } }));
  assert.strictEqual(gsse.usage.reasoning, 3, 'gemini stream carries thoughts');

  // 20. TokenMeter: accounting + pressure projection + round-trip
  const meter = PC.createTokenMeter({ limit: 100000 });
  meter.add({ in: 10000, out: 500 });
  meter.generated(800); /* streamed output not reported via usage */
  assert.deepStrictEqual(meter.stats(), { calls: 1, in: 10000, out: 500, cached: 0, reasoning: 0, peakIn: 10000 }, 'stats accumulate');
  assert.ok(Math.abs(meter.pressure() - 11300 / 100000) < 1e-9, 'pressure = lastIn + outSince over limit');
  meter.add({ in: 11500, out: 2000, cached: 8000, reasoning: 300 });
  assert.strictEqual(meter.stats().calls, 2, 'second call counted');
  assert.strictEqual(meter.stats().cached, 8000, 'cache savings tracked');
  assert.ok(Math.abs(meter.pressure() - 13500 / 100000) < 1e-9, 'outSince resets on add');
  assert.strictEqual(PC.createTokenMeter({}).pressure(), 0, 'no limit = zero pressure');
  meter.add(null);
  assert.strictEqual(meter.stats().calls, 2, 'null usage is a no-op');
  const snap = meter.toJSON();
  const meter2 = PC.createTokenMeter({});
  meter2.fromJSON(snap);
  assert.deepStrictEqual(meter2.stats(), meter.stats(), 'meter round-trips');
  assert.strictEqual(meter2.pressure(), meter.pressure(), 'pressure survives the round-trip');
  meter2.fromJSON({ v: 2 }); /* wrong version: ignored, no crash */
  assert.strictEqual(meter2.stats().calls, 2, 'bad snapshot rejected');

  // 21. Anthropic prompt caching: opt-in breakpoints, default unchanged
  const plainBody = PC.buildFamilyBody('anthropic', { model: 'c', messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'u' }], tools: [{ type: 'function', function: { name: 'a' } }, { type: 'function', function: { name: 'b' } }] }, 1024);
  assert.strictEqual(plainBody.system, 'SYS', 'no cache: system is a plain string');
  assert.ok(!plainBody.tools[1].cache_control, 'no cache: tools unmarked');
  const cacheBody = PC.buildFamilyBody('anthropic', { model: 'c', cache: true, messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'u' }], tools: [{ type: 'function', function: { name: 'a' } }, { type: 'function', function: { name: 'b' } }] }, 1024);
  assert.deepStrictEqual(cacheBody.system, [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }], 'cache: system block with ephemeral breakpoint');
  assert.deepStrictEqual(cacheBody.tools[1].cache_control, { type: 'ephemeral' }, 'cache: LAST tool marked');
  assert.ok(!cacheBody.tools[0].cache_control, 'cache: earlier tools unmarked (1 breakpoint on tools)');

  // 22. estimateTokens: the honest fallback
  assert.strictEqual(PC.estimateTokens('abcd'.repeat(10)), 10, '4 chars ≈ 1 token');
  assert.strictEqual(PC.estimateTokens(''), 0, 'empty = 0');

  console.log('providercore: 22/22 scenario groups PASS (kernel + families + token accounting + caching)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
