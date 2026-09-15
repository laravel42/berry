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
