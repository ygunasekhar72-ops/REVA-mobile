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

  console.log('providercore: 13/13 scenario groups PASS (kernel of the provider layer)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
