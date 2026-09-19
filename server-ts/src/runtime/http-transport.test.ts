import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleEnvelope } from './envelope.test.ts';
import { encodeLifecycle, type LifecycleEvent } from './lifecycle.ts';
import { httpTransport } from './http-transport.ts';
import { RuntimeUnavailable, type RuntimeTarget } from './transport.ts';

const target: RuntimeTarget = { id: null, driver: 'http', arn: null, qualifier: 'DEFAULT', region: null, endpointUrl: 'http://agent-runtime:8080/' };

test('invoke posts to /invocations with the AgentCore session header', async () => {
   const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
   const fakeFetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return new Response(encodeLifecycle({ type: 'task.started' }), { headers: { 'content-type': 'text/event-stream' } });
   }) as unknown as typeof fetch;
   const envelope = sampleEnvelope();
   const events: LifecycleEvent[] = [];
   for await (const e of httpTransport({ fetch: fakeFetch, token: 't'.repeat(32), endpointUrl: target.endpointUrl }).invoke({ target, envelope, signal: new AbortController().signal })) events.push(e);
   assert.equal(new Headers(seen[0]?.init?.headers).get('authorization'), `Bearer ${'t'.repeat(32)}`);
   assert.equal(seen[0]!.url, 'http://agent-runtime:8080/invocations');
   assert.equal(new Headers(seen[0]!.init?.headers).get('x-amzn-bedrock-agentcore-runtime-session-id'), envelope.runtimeSessionId);
   assert.deepEqual(events, [{ type: 'task.started' }]);
});

test('a runtime that answers an error status is unavailable', async () => {
   const fakeFetch = (async () => new Response('down', { status: 502 })) as unknown as typeof fetch;
   const iterate = async () => {
      for await (const _ of httpTransport({ fetch: fakeFetch, token: 't'.repeat(32), endpointUrl: target.endpointUrl }).invoke({ target, envelope: sampleEnvelope(), signal: new AbortController().signal })) {
         // drain
      }
   };
   await assert.rejects(iterate, RuntimeUnavailable);
});

test('stop deletes the local session', async () => {
   const seen: string[] = [];
   const fakeFetch = (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method} ${url}`);
      return new Response(null, { status: 204 });
   }) as unknown as typeof fetch;
   await httpTransport({ fetch: fakeFetch, token: 't'.repeat(32), endpointUrl: target.endpointUrl }).stop({ target, runtimeSessionId: 'berry-x' });
   assert.deepEqual(seen, ['DELETE http://agent-runtime:8080/sessions/berry-x']);
});

test('invoke tells an observer the request it sent and the status that came back', async () => {
   const fakeFetch = (async () =>
      new Response(encodeLifecycle({ type: 'task.started' }), { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;
   const seen: { request?: { method: string; url: string; headers: Record<string, string> }; status?: number; type?: string | undefined } = {};
   const observe = {
      request: (request: { method: string; url: string; headers: Record<string, string> }) => void (seen.request = request),
      response: (response: { status: number; headers: Record<string, string> }) => {
         seen.status = response.status;
         seen.type = response.headers['content-type'];
      },
   };
   for await (const _ of httpTransport({ fetch: fakeFetch, token: 't'.repeat(32), endpointUrl: target.endpointUrl }).invoke({ target, envelope: sampleEnvelope(), signal: new AbortController().signal, observe })) {
      // drain
   }
   assert.equal(seen.request?.method, 'POST');
   assert.equal(seen.request?.url, 'http://agent-runtime:8080/invocations');
   assert.equal(seen.request?.headers.accept, 'text/event-stream');
   assert.equal(seen.status, 200);
   assert.equal(seen.type, 'text/event-stream');
});

test('a stream that goes silent, keepalives included, ends as unavailable and releases the request', async () => {
   // What happened for real: the runtime container was removed under an open
   // stream behind a port forward, the socket never closed, and the run sat
   // "dispatching" with its lease renewed for good.
   let requestSignal: AbortSignal | undefined;
   const fakeFetch = (async (_url: string, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
         start(controller) {
            controller.enqueue(new TextEncoder().encode(encodeLifecycle({ type: 'task.started' })));
            // …and then nothing, ever.
         },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
   }) as unknown as typeof fetch;
   const events: LifecycleEvent[] = [];
   const transport = httpTransport({ fetch: fakeFetch, token: 't'.repeat(32), endpointUrl: target.endpointUrl, idleMs: 50 });
   await assert.rejects(async () => {
      for await (const e of transport.invoke({ target, envelope: sampleEnvelope(), signal: new AbortController().signal })) events.push(e);
   }, (error: unknown) => error instanceof RuntimeUnavailable && /sent nothing/.test(error.message));
   assert.deepEqual(events, [{ type: 'task.started' }]);
   assert.equal(requestSignal?.aborted, true);
});

test('keepalives keep a quiet stream alive', async () => {
   const fakeFetch = (async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
         async start(controller) {
            controller.enqueue(encoder.encode(encodeLifecycle({ type: 'task.started' })));
            for (let i = 0; i < 4; i += 1) {
               await new Promise((resolve) => setTimeout(resolve, 30));
               controller.enqueue(encoder.encode(': keepalive\n\n'));
            }
            controller.enqueue(encoder.encode(encodeLifecycle({ type: 'task.failed', failure: { code: 'X', message: 'm', retryable: false } })));
            controller.close();
         },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
   }) as unknown as typeof fetch;
   const events: LifecycleEvent[] = [];
   const transport = httpTransport({ fetch: fakeFetch, token: 't'.repeat(32), endpointUrl: target.endpointUrl, idleMs: 80 });
   for await (const e of transport.invoke({ target, envelope: sampleEnvelope(), signal: new AbortController().signal })) events.push(e);
   assert.deepEqual(events.map((e) => e.type), ['task.started', 'task.failed']);
});
