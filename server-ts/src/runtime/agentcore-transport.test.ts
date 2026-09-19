import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InvokeAgentRuntimeCommand, StopRuntimeSessionCommand } from '@aws-sdk/client-bedrock-agentcore';
import { sampleEnvelope } from './envelope.test.ts';
import { encodeLifecycle, type LifecycleEvent } from './lifecycle.ts';
import { agentCoreTransport } from './agentcore-transport.ts';
import { RuntimeUnavailable, type RuntimeTarget } from './transport.ts';

const target: RuntimeTarget = {
   id: null, driver: 'agentcore', arn: 'arn:aws:bedrock-agentcore:us-east-1:1:runtime/berry-abc',
   qualifier: 'DEFAULT', region: 'us-east-1', endpointUrl: null,
};

function stream(events: LifecycleEvent[]): AsyncIterable<Uint8Array> {
   const bytes = new TextEncoder().encode(events.map(encodeLifecycle).join(''));
   return (async function* () {
      yield bytes.subarray(0, 10);
      yield bytes.subarray(10);
   })();
}

test('invoke sends the envelope as the payload on the (agent, issue) session and reads the stream', async () => {
   const sent: unknown[] = [];
   const client = {
      send: async (command: unknown) => {
         sent.push(command);
         return { response: stream([{ type: 'task.started' }, { type: 'task.completed', result: { text: 'ok', truncated: false, delivery: null } }]) };
      },
   };
   const transport = agentCoreTransport({ region: 'us-east-1', client: client as never });
   const envelope = sampleEnvelope();
   const events: LifecycleEvent[] = [];
   for await (const event of transport.invoke({ target, envelope, signal: new AbortController().signal })) events.push(event);
   assert.equal(events.length, 2);
   const command = sent[0];
   assert.ok(command instanceof InvokeAgentRuntimeCommand);
   assert.equal(command.input.runtimeSessionId, envelope.runtimeSessionId);
   assert.equal(command.input.agentRuntimeArn, target.arn);
   // The SDK types the payload as any blob input; the transport always sends bytes.
   assert.deepEqual(JSON.parse(new TextDecoder().decode(command.input.payload as Uint8Array)), envelope);
});

const completed: LifecycleEvent[] = [
   { type: 'task.started' },
   { type: 'task.completed', result: { text: 'ok', truncated: false, delivery: null } },
];

async function invokeWithBody(body: unknown): Promise<LifecycleEvent[]> {
   const client = { send: async () => ({ response: body }) };
   const transport = agentCoreTransport({ region: 'us-east-1', client: client as never });
   const events: LifecycleEvent[] = [];
   for await (const event of transport.invoke({ target, envelope: sampleEnvelope(), signal: new AbortController().signal })) {
      events.push(event);
   }
   return events;
}

test('invoke reads a buffered Uint8Array body (service returned the SSE whole)', async () => {
   const bytes = new TextEncoder().encode(completed.map(encodeLifecycle).join(''));
   assert.deepEqual(await invokeWithBody(bytes), completed);
});

test('invoke reads a string body', async () => {
   assert.deepEqual(await invokeWithBody(completed.map(encodeLifecycle).join('')), completed);
});

test('invoke reads a web ReadableStream body (undici/fetch handler)', async () => {
   const bytes = new TextEncoder().encode(completed.map(encodeLifecycle).join(''));
   const readable = new ReadableStream<Uint8Array>({
      start(controller) {
         controller.enqueue(bytes.subarray(0, 12));
         controller.enqueue(bytes.subarray(12));
         controller.close();
      },
   });
   assert.deepEqual(await invokeWithBody(readable), completed);
});

test('invoke rejects a body that is neither a stream nor bytes', async () => {
   await assert.rejects(() => invokeWithBody({ not: 'a stream' }), RuntimeUnavailable);
});

test('a refused invoke is RuntimeUnavailable', async () => {
   const client = { send: async () => { throw new Error('ThrottlingException'); } };
   const transport = agentCoreTransport({ region: 'us-east-1', client: client as never });
   const iterate = async () => {
      for await (const _ of transport.invoke({ target, envelope: sampleEnvelope(), signal: new AbortController().signal })) {
         // drain
      }
   };
   await assert.rejects(iterate, RuntimeUnavailable);
});

test('stop is StopRuntimeSession on the same session, and never throws', async () => {
   const sent: unknown[] = [];
   const client = { send: async (command: unknown) => { sent.push(command); throw new Error('gone'); } };
   await agentCoreTransport({ region: 'us-east-1', client: client as never }).stop({ target, runtimeSessionId: `berry-${'0'.repeat(64)}` });
   assert.ok(sent[0] instanceof StopRuntimeSessionCommand);
});

test('an observer sees the signed request and the raw response of a real SDK client', async () => {
   const { BedrockAgentCoreClient } = await import('@aws-sdk/client-bedrock-agentcore');
   const { Readable } = await import('node:stream');
   const client = new BedrockAgentCoreClient({
      region: 'us-east-1',
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret-example', sessionToken: 'session-example' },
      // The network is replaced, not the SDK: signing and the middleware stack run as in production.
      requestHandler: {
         handle: async () => ({
            response: {
               statusCode: 200,
               headers: { 'content-type': 'text/event-stream', 'x-amzn-requestid': 'req-1' },
               body: Readable.from([encodeLifecycle({ type: 'task.started' })]),
            },
         }),
      } as never,
   });
   const seen: { url?: string; headers?: Record<string, string>; status?: number; requestId?: string | undefined } = {};
   const observe = {
      request: (request: { url: string; headers: Record<string, string> }) => {
         seen.url = request.url;
         seen.headers = request.headers;
      },
      response: (response: { status: number; headers: Record<string, string> }) => {
         seen.status = response.status;
         seen.requestId = response.headers['x-amzn-requestid'];
      },
   };
   const envelope = sampleEnvelope();
   for await (const _ of agentCoreTransport({ region: 'us-east-1', client }).invoke({ target, envelope, signal: new AbortController().signal, observe })) {
      // drain
   }
   assert.match(seen.url ?? '', /^https:\/\/bedrock-agentcore\.us-east-1\.amazonaws\.com\/runtimes\/.+\/invocations\?qualifier=DEFAULT$/);
   assert.match(seen.headers?.authorization ?? '', /^AWS4-HMAC-SHA256 /);
   assert.equal(seen.headers?.['x-amzn-bedrock-agentcore-runtime-session-id'], envelope.runtimeSessionId);
   assert.equal(seen.status, 200);
   assert.equal(seen.requestId, 'req-1');
});
