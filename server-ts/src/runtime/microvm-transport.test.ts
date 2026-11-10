import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleEnvelope } from './envelope.test.ts';
import { encodeLifecycle, type LifecycleEvent } from './lifecycle.ts';
import {
   awsMicrovmApi,
   microvmHealth,
   microvmTransport,
   type MicrovmApi,
   type MicrovmSession,
   type MicrovmSessions,
   type MicrovmSettings,
} from './microvm-transport.ts';
import { RunNotResumable, RuntimeUnavailable, type RuntimeTarget } from './transport.ts';

const settings: MicrovmSettings = {
   region: 'us-east-1',
   imageArn: 'arn:aws:lambda:us-east-1:123456789012:microvm-image:berry-runtime',
   imageVersion: '1.0',
   executionRoleArn: null,
   idleSeconds: 900,
   suspendedSeconds: 3600,
   logGroup: null,
};

const target: RuntimeTarget = {
   id: null,
   driver: 'microvm',
   arn: settings.imageArn,
   qualifier: '1.0',
   region: 'us-east-1',
   endpointUrl: null,
};

/** AWS as the tests see it: VMs by id with a state, and every call recorded. */
function fakeApi(options: { state?: (id: string) => string | null } = {}) {
   const calls: string[] = [];
   let next = 0;
   const api: MicrovmApi = {
      async run() {
         next += 1;
         calls.push(`run vm-${next}`);
         return { microvmId: `vm-${next}`, endpoint: `vm-${next}.lambda-microvm.us-east-1.on.aws` };
      },
      async state(id) {
         calls.push(`state ${id}`);
         return options.state ? options.state(id) : 'RUNNING';
      },
      async token(id, minutes) {
         calls.push(`token ${id} ${minutes}`);
         return `token-for-${id}`;
      },
      async terminate(id) {
         calls.push(`terminate ${id}`);
      },
      async image() {
         return { state: 'CREATED', activeVersion: '1.0' };
      },
   };
   return { api, calls };
}

function memorySessions(initial: Record<string, MicrovmSession> = {}): MicrovmSessions & { rows: Map<string, MicrovmSession> } {
   const rows = new Map(Object.entries(initial));
   return {
      rows,
      async find(id) {
         return rows.get(id) ?? null;
      },
      async claim(id, _region, session) {
         if (!rows.has(id)) rows.set(id, session);
         return rows.get(id)!;
      },
      async touch() {},
      async forget(id, microvmId) {
         if (rows.get(id)?.microvmId === microvmId) rows.delete(id);
      },
   };
}

/** A runtime that answers /ping and streams one lifecycle frame for /invocations. */
function fakeRuntime() {
   const seen: Array<{ url: string; headers: Headers; body: string | undefined }> = [];
   const doFetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.endsWith('/ping')) return new Response('{"status":"Healthy"}', { status: 200 });
      return new Response(encodeLifecycle({ type: 'task.started' }), { headers: { 'content-type': 'text/event-stream' } });
   }) as unknown as typeof fetch;
   return { doFetch, seen };
}

async function drain(stream: AsyncIterable<LifecycleEvent>): Promise<LifecycleEvent[]> {
   const events: LifecycleEvent[] = [];
   for await (const event of stream) events.push(event);
   return events;
}

const noSleep = async () => undefined;

test('a first invoke starts a VM, waits for it, and posts the envelope through the proxy', async () => {
   const { api, calls } = fakeApi();
   const sessions = memorySessions();
   const runtime = fakeRuntime();
   const transport = microvmTransport({ settings, api, sessions, fetch: runtime.doFetch, sleep: noSleep });
   const envelope = sampleEnvelope();

   const events = await drain(transport.invoke({ target, envelope, signal: new AbortController().signal }));

   assert.deepEqual(events, [{ type: 'task.started' }]);
   assert.deepEqual(calls, ['run vm-1', 'token vm-1 60']);
   assert.deepEqual(sessions.rows.get(envelope.runtimeSessionId), {
      microvmId: 'vm-1',
      endpoint: 'vm-1.lambda-microvm.us-east-1.on.aws',
   });
   assert.equal(runtime.seen[0]!.url, 'https://vm-1.lambda-microvm.us-east-1.on.aws/ping');
   const invoke = runtime.seen[1]!;
   assert.equal(invoke.url, 'https://vm-1.lambda-microvm.us-east-1.on.aws/invocations');
   assert.equal(invoke.headers.get('x-aws-proxy-auth'), 'token-for-vm-1');
   assert.equal(invoke.headers.get('x-aws-proxy-port'), '8080');
   assert.equal(invoke.headers.get('x-amzn-bedrock-agentcore-runtime-session-id'), envelope.runtimeSessionId);
   assert.equal(JSON.parse(invoke.body!).runId, envelope.runId);
});

test('the next turn of a session goes to the VM that holds it, with the cached token', async () => {
   const { api, calls } = fakeApi();
   const sessions = memorySessions();
   const runtime = fakeRuntime();
   const transport = microvmTransport({ settings, api, sessions, fetch: runtime.doFetch, sleep: noSleep });
   const envelope = sampleEnvelope();

   await drain(transport.invoke({ target, envelope, signal: new AbortController().signal }));
   await drain(transport.invoke({ target, envelope, signal: new AbortController().signal }));

   assert.deepEqual(calls, ['run vm-1', 'token vm-1 60', 'state vm-1']);
});

test('a VM that AWS ended is forgotten and replaced', async () => {
   const { api, calls } = fakeApi({ state: (id) => (id === 'vm-old' ? 'TERMINATED' : 'RUNNING') });
   const envelope = sampleEnvelope();
   const sessions = memorySessions({
      [envelope.runtimeSessionId]: { microvmId: 'vm-old', endpoint: 'vm-old.lambda-microvm.us-east-1.on.aws' },
   });
   const runtime = fakeRuntime();
   const transport = microvmTransport({ settings, api, sessions, fetch: runtime.doFetch, sleep: noSleep });

   await drain(transport.invoke({ target, envelope, signal: new AbortController().signal }));

   assert.deepEqual(calls.slice(0, 2), ['state vm-old', 'run vm-1']);
   assert.equal(sessions.rows.get(envelope.runtimeSessionId)?.microvmId, 'vm-1');
});

test('when another server claimed the session first, the VM started here is terminated', async () => {
   const { api, calls } = fakeApi();
   const envelope = sampleEnvelope();
   const sessions = memorySessions();
   const claim = sessions.claim.bind(sessions);
   sessions.claim = async (id, region) => {
      await claim(id, region, { microvmId: 'vm-theirs', endpoint: 'vm-theirs.lambda-microvm.us-east-1.on.aws' });
      return sessions.rows.get(id)!;
   };
   const runtime = fakeRuntime();
   const transport = microvmTransport({ settings, api, sessions, fetch: runtime.doFetch, sleep: noSleep });

   await drain(transport.invoke({ target, envelope, signal: new AbortController().signal }));

   assert.ok(calls.includes('terminate vm-1'));
   assert.equal(runtime.seen.at(-1)!.url, 'https://vm-theirs.lambda-microvm.us-east-1.on.aws/invocations');
});

test('a VM that never answers /ping makes the runtime unavailable', async () => {
   const { api } = fakeApi();
   let now = 0;
   const doFetch = (async () => new Response('starting', { status: 503 })) as unknown as typeof fetch;
   const transport = microvmTransport({
      settings,
      api,
      sessions: memorySessions(),
      fetch: doFetch,
      readyTimeoutMs: 10_000,
      clock: () => now,
      sleep: async (ms) => {
         now += ms;
      },
   });

   await assert.rejects(
      drain(transport.invoke({ target, envelope: sampleEnvelope(), signal: new AbortController().signal })),
      RuntimeUnavailable
   );
});

test('a token close to expiry is replaced before it is used', async () => {
   const { api, calls } = fakeApi();
   let now = 0;
   const runtime = fakeRuntime();
   const transport = microvmTransport({
      settings,
      api,
      sessions: memorySessions(),
      fetch: runtime.doFetch,
      clock: () => now,
      sleep: noSleep,
   });
   const envelope = sampleEnvelope();

   await drain(transport.invoke({ target, envelope, signal: new AbortController().signal }));
   now += 56 * 60_000;
   await drain(transport.invoke({ target, envelope, signal: new AbortController().signal }));

   assert.equal(calls.filter((call) => call.startsWith('token')).length, 2);
});

test('stop terminates the session VM and forgets it', async () => {
   const { api, calls } = fakeApi();
   const envelope = sampleEnvelope();
   const sessions = memorySessions({
      [envelope.runtimeSessionId]: { microvmId: 'vm-7', endpoint: 'vm-7.lambda-microvm.us-east-1.on.aws' },
   });
   const transport = microvmTransport({ settings, api, sessions, fetch: fakeRuntime().doFetch, sleep: noSleep });

   await transport.stop({ target, runtimeSessionId: envelope.runtimeSessionId });

   assert.deepEqual(calls, ['terminate vm-7']);
   assert.equal(sessions.rows.size, 0);
});

test('a run cannot be resumed once its VM is gone', async () => {
   const { api } = fakeApi();
   const transport = microvmTransport({
      settings,
      api,
      sessions: memorySessions(),
      fetch: fakeRuntime().doFetch,
      sleep: noSleep,
   });

   await assert.rejects(
      drain(
         transport.resume!({
            target,
            runtimeSessionId: sampleEnvelope().runtimeSessionId,
            runId: 'run-1',
            after: 3,
            signal: new AbortController().signal,
         })
      ),
      RunNotResumable
   );
});

test('health needs a built image with a version to run', async () => {
   const { api } = fakeApi();
   await microvmHealth(api, settings);

   api.image = async () => ({ state: 'CREATING', activeVersion: null });
   await assert.rejects(microvmHealth(api, settings), /CREATING/);

   api.image = async () => ({ state: 'CREATED', activeVersion: null });
   await assert.rejects(microvmHealth(api, { ...settings, imageVersion: null }), /no active version/);
});

test('RunMicrovm sends no run hook payload, which an image without hooks refuses', async () => {
   const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
   const client = {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
         sent.push({ name: command.constructor.name, input: command.input });
         return { microvmId: 'vm-1', endpoint: 'vm-1.lambda-microvm.us-east-1.on.aws' };
      },
   };
   const api = awsMicrovmApi({ region: 'us-east-1', client: client as never });

   await api.run(settings, sampleEnvelope().runtimeSessionId);

   assert.equal(sent[0]!.name, 'RunMicrovmCommand');
   assert.equal('runHookPayload' in sent[0]!.input, false);
   assert.equal(sent[0]!.input.imageIdentifier, settings.imageArn);
   assert.equal(sent[0]!.input.imageVersion, '1.0');
});
