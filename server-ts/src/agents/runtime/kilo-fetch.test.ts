import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GatewaySilent, kiloFetch, reasoningText, reportedCostMicros, toUncachedUsage, withAnthropicCachePoints, type GatewayUsage } from './kilo-fetch.ts';

/**
 * The gateway rules, against a scripted upstream: a paid reply passes whether
 * the deployment's own key served it or Kilo credits did (2026-09-26), its
 * usage made uncached, and Anthropic requests carry cache points on their
 * stable prefix.
 */

function upstream(body: string, type: string, seen?: { body?: string }): typeof fetch {
   return async (_input, init) => {
      if (seen) seen.body = String(init?.body);
      return new Response(body, { status: 200, headers: { 'content-type': type } });
   };
}

const request = (model: string) => ({
   method: 'POST',
   body: JSON.stringify({ model, messages: [{ role: 'system', content: 'You are Berry.' }, { role: 'user', content: 'hi' }] }),
});

async function drain(response: Response): Promise<string> {
   return await response.text();
}

test('a paid JSON reply billed to gateway credits passes, its cost the one Kilo billed', async () => {
   const reports: GatewayUsage[] = [];
   const guarded = kiloFetch({ onUsage: (u) => reports.push(u) }, upstream('{"usage":{"is_byok":false,"cost":0.01}}', 'application/json'));
   const response = await guarded('https://gw/chat/completions', request('deepseek/deepseek-v4.1-flash'));
   assert.equal(response.status, 200);
   assert.equal(reportedCostMicros(reports[0]!), 10_000);
});

test('a paid JSON reply served by the own key passes, with its usage made uncached', async () => {
   const body = '{"usage":{"prompt_tokens":120,"prompt_tokens_details":{"cached_tokens":100},"is_byok":true,"cost":0}}';
   const reports: GatewayUsage[] = [];
   const guarded = kiloFetch({ onUsage: (u) => reports.push(u) }, upstream(body, 'application/json'));
   const response = await guarded('https://gw', request('anthropic/claude-haiku-4.5'));
   assert.equal(response.status, 200);
   assert.equal(((await response.json()) as { usage: GatewayUsage }).usage.prompt_tokens, 20);
   assert.equal(reports[0]!.prompt_tokens, 120);
});

test('a paid stream billed to gateway credits streams through, even with its usage split across chunks', async () => {
   const chunks = ['data: {"choices":[{"delta":{"content":"pong"}}]}\n\n', 'data: {"usage":{"is_b', 'yok": false}}\n\n'];
   const inner: typeof fetch = async () =>
      new Response(
         new ReadableStream({
            start(controller) {
               for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
               controller.close();
            },
         }),
         { status: 200, headers: { 'content-type': 'text/event-stream' } }
      );
   const reports: GatewayUsage[] = [];
   const response = await kiloFetch({ onUsage: (u) => reports.push(u) }, inner)('https://gw', request('openai/gpt-5.6-sol'));
   assert.match(await drain(response), /pong/);
   assert.equal(reports[0]!.is_byok, false);
});

test('a streamed reply keeps its content and gets its usage on a chunk of its own, uncached', async () => {
   const sse =
      'data: {"id":"g","choices":[{"delta":{"content":"ok"}}]}\n\n' +
      'data: {"id":"g","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":11213,"completion_tokens":4,' +
      '"prompt_tokens_details":{"cached_tokens":11200},"cache_creation_input_tokens":0,"is_byok":true,"cost":0,' +
      '"cost_details":{"upstream_inference_cost":0.001153}}}\n\n' +
      'data: [DONE]\n\n';
   const reports: GatewayUsage[] = [];
   const response = await kiloFetch({ onUsage: (u) => reports.push(u) }, upstream(sse, 'text/event-stream'))('https://gw', request('anthropic/claude-haiku-4.5'));
   const events = (await drain(response)).split('\n\n').filter(Boolean);
   assert.equal(events.length, 4);
   assert.equal(events[0], 'data: {"id":"g","choices":[{"delta":{"content":"ok"}}]}');
   const finish = JSON.parse(events[1]!.slice(5));
   assert.equal(finish.usage, undefined);
   assert.equal(finish.choices[0].finish_reason, 'stop');
   const usageOnly = JSON.parse(events[2]!.slice(5));
   assert.deepEqual(usageOnly.choices, []);
   assert.equal(usageOnly.usage.prompt_tokens, 13);
   assert.equal(usageOnly.usage.prompt_tokens_details.cached_tokens, 11200);
   assert.equal(events[3], 'data: [DONE]');
   assert.equal(reports.length, 1);
   assert.equal(reports[0]!.prompt_tokens, 11213);
});

test('a free model has no own key to be served by, so it is never refused', async () => {
   const body = '{"usage":{"is_byok":false,"cost":0}}';
   const response = await kiloFetch({}, upstream(body, 'application/json'))('https://gw', request('qwen/qwen3.8-27b:free'));
   assert.equal(response.status, 200);
});

test('an Anthropic request marks its system prompt, last tool and newest message for caching', async () => {
   const seen: { body?: string } = {};
   const init = {
      method: 'POST',
      body: JSON.stringify({
         model: 'anthropic/claude-sonnet-5',
         messages: [{ role: 'system', content: 'rules' }, { role: 'user', content: 'hi' }],
         tools: [{ type: 'function', function: { name: 'a' } }, { type: 'function', function: { name: 'b' } }],
      }),
   };
   await kiloFetch({}, upstream('{}', 'application/json', seen))('https://gw', init);
   const sent = JSON.parse(seen.body!);
   assert.deepEqual(sent.messages[0].content, [{ type: 'text', text: 'rules', cache_control: { type: 'ephemeral' } }]);
   assert.deepEqual(sent.messages[1].content, [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }]);
   assert.equal(sent.tools[0].cache_control, undefined);
   assert.deepEqual(sent.tools[1].cache_control, { type: 'ephemeral' });
});

test('an agent step marks its newest message and the one that ended the previous request, and no more than four in all', () => {
   const cached = (content: unknown) => JSON.stringify(content).includes('cache_control');
   const body = withAnthropicCachePoints({
      model: 'anthropic/claude-opus-5.5',
      messages: [
         { role: 'system', content: 'rules' },
         { role: 'user', content: 'Build the page.' },
         { role: 'assistant', content: null, tool_calls: [{ id: 'a' }] } as never,
         { role: 'tool', content: 'file a' } as never,
         { role: 'assistant', content: null, tool_calls: [{ id: 'b' }, { id: 'c' }] } as never,
         { role: 'tool', content: 'file b' } as never,
         { role: 'tool', content: [{ type: 'text', text: 'file c' }] } as never,
      ],
      tools: [{ type: 'function', function: { name: 'read_file' } }],
   });
   const marks = body.messages!.map((message) => cached(message.content));
   // system, the tool result that ended the previous request, and the newest.
   assert.deepEqual(marks, [true, false, false, true, false, false, true]);
   const total = marks.filter(Boolean).length + (body.tools ?? []).filter((tool) => 'cache_control' in tool).length;
   assert.equal(total, 4, "Anthropic's limit");
});

test('a single call caches its system prompt and tools, not a conversation nothing reads again', () => {
   const body = withAnthropicCachePoints(
      {
         model: 'anthropic/claude-haiku-4.5',
         messages: [
            { role: 'system', content: 'rules' },
            { role: 'user', content: 'triage this' },
         ],
         tools: [{ type: 'function' }],
      },
      { conversation: false }
   );
   assert.deepEqual(body.messages?.[1], { role: 'user', content: 'triage this' });
   assert.ok(JSON.stringify(body.messages?.[0]).includes('cache_control'));
   assert.ok('cache_control' in body.tools![0]!);
});

test('any other vendor is sent exactly as the SDK built it', () => {
   const body = { model: 'openai/gpt-5.6-sol', messages: [{ role: 'system', content: 'rules' }] };
   assert.deepEqual(withAnthropicCachePoints(body), body);
});

test('the cost is what the own key was charged, or what Kilo billed, and unknown when unreported', () => {
   assert.equal(reportedCostMicros({ is_byok: true, cost: 0, cost_details: { upstream_inference_cost: 0.014033 } }), 14033);
   assert.equal(reportedCostMicros({ is_byok: false, cost: 0 }), 0);
   assert.equal(reportedCostMicros({ is_byok: true, cost: 0 }), null);
   assert.equal(reportedCostMicros({}), null);
});

test('input tokens exclude what was read from or written to the cache', () => {
   const usage = { prompt_tokens: 11213, prompt_tokens_details: { cached_tokens: 0 }, cache_creation_input_tokens: 11200 };
   assert.equal(toUncachedUsage(usage).prompt_tokens, 13);
   assert.equal(toUncachedUsage({ prompt_tokens: 5 }).prompt_tokens, 5);
});

test("Kilo's auto-routing is exempt from the own-key refusal, and the picked model is reported", async () => {
   const body = '{"model":"z-ai/glm-5.3-flash","usage":{"is_byok":false,"cost":0.0002}}';
   const seen: Array<string | null> = [];
   const guarded = kiloFetch({ onUsage: (_u, model) => seen.push(model) }, upstream(body, 'application/json'));
   const response = await guarded('https://gw', request('kilo-auto/efficient'));
   assert.equal(response.status, 200);
   assert.deepEqual(seen, ['z-ai/glm-5.3-flash']);
});

test('reasoning the model streams is read, in each shape gateways send it, and passed on unchanged', async () => {
   assert.equal(reasoningText('{"choices":[{"delta":{"reasoning":"abc"}}]}'), 'abc');
   assert.equal(reasoningText('{"choices":[{"delta":{"reasoning_content":"abcd"}}]}'), 'abcd');
   assert.equal(reasoningText('{"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"ab"}]}}]}'), 'ab');
   assert.equal(
      reasoningText('{"choices":[{"delta":{"reasoning":"once","reasoning_details":[{"type":"reasoning.text","text":"once"}]}}]}'),
      'once',
      'the same passage sent twice is read once'
   );
   assert.equal(reasoningText('{"choices":[{"delta":{"content":"no reasoning here"}}]}'), '');
   const sse =
      'data: {"id":"g","choices":[{"delta":{"reasoning":"let me think"}}]}\n\n' +
      'data: {"id":"g","choices":[{"delta":{"reasoning":" more"}}]}\n\n' +
      'data: {"id":"g","choices":[{"delta":{"content":"ok"}}]}\n\n' +
      'data: [DONE]\n\n';
   const seen: string[] = [];
   const response = await kiloFetch({ onReasoning: (text) => seen.push(text) }, upstream(sse, 'text/event-stream'))('https://gw', request('moonshotai/kimi-k3'));
   assert.equal(await drain(response), sse);
   assert.deepEqual(seen, ['let me think', ' more']);
});

/**
 * Silence, and the difference between it and a slow answer.
 *
 * The gateway took a plan repair and never answered. Berry gave up on the run
 * after five minutes, but the request stayed open, and the session's
 * container with it: the local router does not reap a session while a request
 * is in flight, so one stall held a container slot until somebody killed it
 * by hand.
 */

/**
 * An open socket, which is what holds the event loop while a real request is
 * in flight. The stall timer is unref'd — it must not keep the runtime alive
 * on its own — so a fake with no I/O would let the loop drain before it fires.
 */
function held(): { clear: () => void } {
   const timer = setTimeout(() => undefined, 10_000);
   return { clear: () => clearTimeout(timer) };
}

/** A gateway that accepts the request and then says nothing at all. */
function mute(seen: { signal?: AbortSignal | undefined }): typeof fetch {
   return (_input, init) =>
      new Promise((_resolve, reject) => {
         const socket = held();
         seen.signal = init?.signal ?? undefined;
         init?.signal?.addEventListener('abort', () => {
            socket.clear();
            reject(new Error('aborted'));
         });
      });
}

/**
 * An event stream that sends `count` chunks `everyMs` apart and then goes
 * quiet without ending — a reply that stopped halfway. Aborting the request
 * errors the body, as `fetch` does.
 */
function trickle(count: number, everyMs: number): typeof fetch {
   return async (_input, init) => {
      const socket = held();
      return new Response(
         new ReadableStream<Uint8Array>({
            async start(controller) {
               init?.signal?.addEventListener('abort', () => {
                  socket.clear();
                  controller.error(new Error('aborted'));
               });
               for (let sent = 0; sent < count; sent += 1) {
                  await new Promise((resolve) => setTimeout(resolve, everyMs));
                  if (init?.signal?.aborted) return;
                  controller.enqueue(new TextEncoder().encode(`data: {"choices":[{"delta":{"content":"${sent}"}}]}\n\n`));
               }
            },
            cancel() {
               socket.clear();
            },
         }),
         { status: 200, headers: { 'content-type': 'text/event-stream' } }
      );
   };
}

test('a gateway that never answers is abandoned, and its socket closed with it', async () => {
   const seen: { signal?: AbortSignal | undefined } = {};
   const call = kiloFetch({ stallMs: 25 }, mute(seen));

   await assert.rejects(
      () => call('https://gw', request('qwen/qwen3-coder-next')),
      (error: unknown) => error instanceof GatewaySilent && /sent nothing for/.test(error.message)
   );
   // The point is not that the wait ended: it is that the request did. An
   // abandoned call whose socket stays open is what kept the container alive.
   assert.equal(seen.signal?.aborted, true);
});

test('a reply that keeps arriving is never cut off, however long it takes in total', async () => {
   // The deadline is on silence, not on the call. A plan is minutes of work
   // and a capped call would fail the slowest plans rather than the stuck ones.
   const response = await kiloFetch({ stallMs: 60 }, trickle(6, 10))('https://gw', request('qwen/qwen3-coder-next'));
   const reader = response.body!.getReader();
   const decoder = new TextDecoder();
   let text = '';
   while (!text.includes('"5"')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
   }
   await reader.cancel();
   // Six chunks over 60ms, none more than 10ms apart: all through.
   assert.equal(text.match(/delta/g)?.length, 6);
});

test('a stream that stops halfway is abandoned like one that never started', async () => {
   const response = await kiloFetch({ stallMs: 25 }, trickle(1, 1))('https://gw', request('qwen/qwen3-coder-next'));
   const reader = response.body!.getReader();
   assert.match(new TextDecoder().decode((await reader.read()).value), /delta/);
   await assert.rejects(() => reader.read(), (error: unknown) => error instanceof GatewaySilent);
});

/** Data events, then only `: ping` comments, which must not keep the call open. */
function thenComments(dataCount: number, everyMs: number): typeof fetch {
   const encoder = new TextEncoder();
   return async (_input, init) => {
      const socket = held();
      return new Response(
         new ReadableStream<Uint8Array>({
            async start(controller) {
               init?.signal?.addEventListener('abort', () => {
                  socket.clear();
                  controller.error(new Error('aborted'));
               });
               for (let sent = 0; sent < dataCount; sent += 1) {
                  await new Promise((resolve) => setTimeout(resolve, everyMs));
                  if (init?.signal?.aborted) return;
                  controller.enqueue(encoder.encode(`data: {"choices":[{"delta":{"content":"${sent}"}}]}\n\n`));
               }
               for (;;) {
                  await new Promise((resolve) => setTimeout(resolve, everyMs));
                  if (init?.signal?.aborted) return;
                  controller.enqueue(encoder.encode(': ping\n\n'));
               }
            },
            cancel() {
               socket.clear();
            },
         }),
         { status: 200, headers: { 'content-type': 'text/event-stream' } }
      );
   };
}

/** Comments for `quietMs`, then one data event. A think before the first token. */
function commentsThen(quietMs: number, everyMs: number): typeof fetch {
   const encoder = new TextEncoder();
   return async (_input, init) => {
      const socket = held();
      return new Response(
         new ReadableStream<Uint8Array>({
            async start(controller) {
               init?.signal?.addEventListener('abort', () => {
                  socket.clear();
                  controller.error(new Error('aborted'));
               });
               const until = Date.now() + quietMs;
               while (Date.now() < until) {
                  await new Promise((resolve) => setTimeout(resolve, everyMs));
                  if (init?.signal?.aborted) return;
                  controller.enqueue(encoder.encode(': ping\n\n'));
               }
               controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ready"}}]}\n\n'));
               controller.close();
            },
            cancel() {
               socket.clear();
            },
         }),
         { status: 200, headers: { 'content-type': 'text/event-stream' } }
      );
   };
}

test('keepalives after the model has spoken do not keep a silent stream open', async () => {
   const response = await kiloFetch({ stallMs: 50 }, thenComments(1, 10))('https://gw', request('qwen/qwen3-coder-next'));
   const reader = response.body!.getReader();
   const started = Date.now();
   let error: unknown = null;
   for (;;) {
      if (Date.now() - started > 1_000) break;
      try {
         const next = await reader.read();
         if (next.done) break;
      } catch (caught) {
         error = caught;
         break;
      }
   }
   assert.ok(error instanceof GatewaySilent);
   assert.ok(Date.now() - started < 500);
});

test('keepalives before the first token still count as the gateway answering', async () => {
   const response = await kiloFetch({ stallMs: 40 }, commentsThen(80, 10))('https://gw', request('qwen/qwen3-coder-next'));
   const reader = response.body!.getReader();
   const decoder = new TextDecoder();
   let text = '';
   while (!text.includes('ready')) {
      const next = await reader.read();
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true });
   }
   await reader.cancel();
   assert.match(text, /ready/);
});
