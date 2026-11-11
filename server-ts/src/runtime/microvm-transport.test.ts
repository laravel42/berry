import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleEnvelope } from './envelope.test.ts';
import { encodeLifecycle, type LifecycleEvent } from './lifecycle.ts';
import {
   assertReachableFromAws,
   awsMicrovmApi,
   microvmHealth,
   microvmTransport,
   privateToThisMachine,
   withCallbackOrigin,
   type MicrovmApi,
   type MicrovmSession,
   type MicrovmSessions,
   type MicrovmSettings,
} from './microvm-transport.ts';
import { RunNotResumable, RuntimeMisconfigured, RuntimeUnavailable, type RuntimeTarget } from './transport.ts';

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
function fakeApi(options: { state?: (id: string) => string | null; version?: string; activeVersion?: string | null } = {}) {
   const calls: string[] = [];
   let next = 0;
   const api: MicrovmApi = {
      async run() {
         next += 1;
         calls.push(`run vm-${next}`);
         return {
            microvmId: `vm-${next}`,
            endpoint: `vm-${next}.lambda-microvm.us-east-1.on.aws`,
            imageVersion: options.version ?? '1.0',
         };
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
         calls.push('image');
         return { state: 'CREATED', activeVersion: options.activeVersion === undefined ? '1.0' : options.activeVersion };
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
      imageVersion: '1.0',
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
      [envelope.runtimeSessionId]: { microvmId: 'vm-old', endpoint: 'vm-old.lambda-microvm.us-east-1.on.aws', imageVersion: '1.0' },
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
      await claim(id, region, { microvmId: 'vm-theirs', endpoint: 'vm-theirs.lambda-microvm.us-east-1.on.aws', imageVersion: '1.0' });
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
      [envelope.runtimeSessionId]: { microvmId: 'vm-7', endpoint: 'vm-7.lambda-microvm.us-east-1.on.aws', imageVersion: '1.0' },
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
         return { microvmId: 'vm-1', endpoint: 'vm-1.lambda-microvm.us-east-1.on.aws', imageVersion: '1.0' };
      },
   };
   const api = awsMicrovmApi({ region: 'us-east-1', client: client as never });

   await api.run(settings, sampleEnvelope().runtimeSessionId);

   assert.equal(sent[0]!.name, 'RunMicrovmCommand');
   assert.equal('runHookPayload' in sent[0]!.input, false);
   assert.equal(sent[0]!.input.imageIdentifier, settings.imageArn);
   assert.equal(sent[0]!.input.imageVersion, '1.0');
});

test('after the image is rebuilt, a session moves off its old VM', async () => {
   const { api, calls } = fakeApi({ version: '1.1' });
   const envelope = sampleEnvelope();
   const sessions = memorySessions({
      [envelope.runtimeSessionId]: { microvmId: 'vm-old', endpoint: 'vm-old.lambda-microvm.us-east-1.on.aws', imageVersion: '1.0' },
   });
   const transport = microvmTransport({
      settings: { ...settings, imageVersion: '1.1' },
      api,
      sessions,
      fetch: fakeRuntime().doFetch,
      sleep: noSleep,
   });

   await drain(transport.invoke({ target, envelope, signal: new AbortController().signal }));

   assert.deepEqual(calls.slice(0, 2), ['terminate vm-old', 'run vm-1']);
   assert.deepEqual(sessions.rows.get(envelope.runtimeSessionId), {
      microvmId: 'vm-1',
      endpoint: 'vm-1.lambda-microvm.us-east-1.on.aws',
      imageVersion: '1.1',
   });
});

test('with no version configured, the image active version decides, asked at most once a minute', async () => {
   const { api, calls } = fakeApi({ version: '1.2', activeVersion: '1.2' });
   const envelope = sampleEnvelope();
   const sessions = memorySessions({
      [envelope.runtimeSessionId]: { microvmId: 'vm-old', endpoint: 'vm-old.lambda-microvm.us-east-1.on.aws', imageVersion: null },
   });
   const transport = microvmTransport({
      settings: { ...settings, imageVersion: null },
      api,
      sessions,
      fetch: fakeRuntime().doFetch,
      sleep: noSleep,
   });

   await drain(transport.invoke({ target, envelope, signal: new AbortController().signal }));
   await drain(transport.invoke({ target, envelope, signal: new AbortController().signal }));

   assert.ok(calls.includes('terminate vm-old'));
   assert.equal(calls.filter((call) => call === 'image').length, 1);
   assert.equal(calls.filter((call) => call.startsWith('run')).length, 1);
});

test('when AWS cannot say which version is active, a running VM is kept', async () => {
   const { api, calls } = fakeApi({ activeVersion: null });
   const envelope = sampleEnvelope();
   const sessions = memorySessions({
      [envelope.runtimeSessionId]: { microvmId: 'vm-7', endpoint: 'vm-7.lambda-microvm.us-east-1.on.aws', imageVersion: '1.0' },
   });
   const transport = microvmTransport({
      settings: { ...settings, imageVersion: null },
      api,
      sessions,
      fetch: fakeRuntime().doFetch,
      sleep: noSleep,
   });

   await drain(transport.invoke({ target, envelope, signal: new AbortController().signal }));

   assert.equal(calls.some((call) => call.startsWith('terminate') || call.startsWith('run')), false);
});

test('privateToThisMachine names the addresses a VM in AWS can never reach', () => {
   for (const url of [
      'http://localhost:4000',
      'http://127.0.0.1:4000',
      'http://host.docker.internal:4000',
      'http://192.168.0.152:1234/v1',
      'http://10.0.0.5',
      'http://172.17.0.1:1234',
      'http://berry:4000',
      'http://studio.local:1234',
      'http://[::1]:4000',
   ]) {
      assert.equal(privateToThisMachine(url), true, url);
   }
   for (const url of ['https://berry.example.com', 'https://lmstudio.example.com/v1', 'http://172.32.0.1', 'https://1.1.1.1']) {
      assert.equal(privateToThisMachine(url), false, url);
   }
});

test('withCallbackOrigin moves Berry and its own MCP servers to the public callback, nothing else', () => {
   const envelope = sampleEnvelope({
      berry: { apiUrl: 'http://host.docker.internal:4000', token: 't' },
   });
   envelope.agent.mcpServers = [
      { name: 'plugin', url: 'http://host.docker.internal:4000/api/v1/plugins/mcp/x', transport: 'streamable_http', headers: {}, allowedTools: null },
      { name: 'other', url: 'https://mcp.example.com/mcp', transport: 'streamable_http', headers: {}, allowedTools: null },
   ];
   const moved = withCallbackOrigin(envelope, 'https://berry.example.com/ignored-path');
   assert.equal(moved.berry.apiUrl, 'https://berry.example.com');
   assert.deepEqual(
      moved.agent.mcpServers.map((server) => server.url),
      ['https://berry.example.com/api/v1/plugins/mcp/x', 'https://mcp.example.com/mcp']
   );
   // The original envelope is not changed.
   assert.equal(envelope.berry.apiUrl, 'http://host.docker.internal:4000');
});

test('assertReachableFromAws refuses a local Berry callback and a local LM Studio, with what to do', () => {
   assert.throws(
      () => assertReachableFromAws(sampleEnvelope({ berry: { apiUrl: 'http://host.docker.internal:4000', token: 't' } })),
      (error: unknown) => error instanceof RuntimeMisconfigured && /BERRY_MICROVM_CALLBACK_URL/.test(error.message)
   );
   const lmstudio = sampleEnvelope({
      runtime: {
         id: 'lmstudio',
         executionMode: 'direct_inference',
         provider: 'LM Studio',
         billing: 'unknown',
         model: 'google/gemma-4-26b-a4b',
         credential: { type: 'api_key', token: 'x', accountId: null, accountName: null, baseUrl: 'http://localhost:1234/v1' },
      },
   });
   assert.throws(
      () => assertReachableFromAws(lmstudio),
      (error: unknown) => error instanceof RuntimeMisconfigured && /LM Studio at localhost:1234/.test(error.message)
   );
   assert.doesNotThrow(() => assertReachableFromAws(sampleEnvelope()));
});

test('an invoke that could not reach Berry is refused before any VM starts', async () => {
   const { api, calls } = fakeApi();
   const runtime = fakeRuntime();
   const transport = microvmTransport({ settings, api, sessions: memorySessions(), fetch: runtime.doFetch, sleep: noSleep });
   const envelope = sampleEnvelope({ berry: { apiUrl: 'http://host.docker.internal:4000', token: 't' } });
   await assert.rejects(
      drain(transport.invoke({ target, envelope, signal: new AbortController().signal })),
      RuntimeMisconfigured
   );
   assert.deepEqual(calls, []);
});

test('with a callback URL the VM is sent the public address instead', async () => {
   const { api } = fakeApi();
   const runtime = fakeRuntime();
   const transport = microvmTransport({
      settings,
      api,
      sessions: memorySessions(),
      fetch: runtime.doFetch,
      sleep: noSleep,
      callbackUrl: 'https://berry.example.com',
   });
   const envelope = sampleEnvelope({ berry: { apiUrl: 'http://host.docker.internal:4000', token: 't' } });
   await drain(transport.invoke({ target, envelope, signal: new AbortController().signal }));
   const invoke = runtime.seen.find((request) => request.url.endsWith('/invocations'));
   assert.equal(JSON.parse(invoke!.body!).berry.apiUrl, 'https://berry.example.com');
});
