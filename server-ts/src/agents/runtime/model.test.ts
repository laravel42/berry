import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BedrockModel, Message, TextBlock } from '@strands-agents/sdk';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import { bedrockModel, KiloModel, DEFAULT_KILO_BASE_URL, DEFAULT_MAX_TOKENS, kiloModel, modelProviderFromEnv } from './model.ts';

/**
 * The one place a Bedrock model is built. What matters is that the spec
 * survives into the model: the id, the ceiling, and — the bug this replaces —
 * the explicit credentials rather than the AWS default chain.
 */

test('the spec reaches the model: id, tokens, temperature', () => {
   const model = bedrockModel({
      model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      region: 'us-east-1',
      maxTokens: 1234,
      temperature: 0.2,
   });
   assert.ok(model instanceof BedrockModel);
   const config = model.getConfig();
   assert.equal(config.modelId, 'us.anthropic.claude-haiku-4-5-20251001-v1:0');
   assert.equal(config.maxTokens, 1234);
   assert.equal(config.temperature, 0.2);
});

test('a completion can ask for the non-streaming API', () => {
   const config = bedrockModel({ model: 'm', region: 'us-east-1', stream: false }).getConfig();
   assert.equal(config.stream, false);
   assert.equal(bedrockModel({ model: 'm', region: 'us-east-1' }).getConfig().stream, undefined);
});

test('a family that accepts less than the default is clamped, not refused', () => {
   assert.equal(bedrockModel({ model: 'us.amazon.nova-pro-v1:0', region: 'r' }).getConfig().maxTokens, 10_000);
   assert.equal(bedrockModel({ model: 'us.amazon.nova-lite-v1:0', region: 'r' }).getConfig().maxTokens, 5_000);
   assert.equal(bedrockModel({ model: 'us.amazon.nova-pro-v1:0', region: 'r', maxTokens: 2_000 }).getConfig().maxTokens, 2_000);
   assert.equal(bedrockModel({ model: 'us.anthropic.claude-sonnet-4-6', region: 'r' }).getConfig().maxTokens, DEFAULT_MAX_TOKENS);
});

test('omitted inference options fall back to the documented ceiling', () => {
   const config = bedrockModel({ model: 'm', region: 'us-east-1' }).getConfig();
   assert.equal(config.maxTokens, DEFAULT_MAX_TOKENS);
   assert.equal(config.temperature, undefined);
});

test('explicit credentials are handed to the client, not the default chain', async () => {
   const model = bedrockModel({
      model: 'm',
      region: 'us-east-1',
      credentials: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' },
   });
   // The SDK keeps the client private; the credentials it resolves are what
   // matter, and reaching in is the only way to see them without a request.
   const client = (model as unknown as { _client: { config: { credentials: () => Promise<{ accessKeyId: string }> } } })._client;
   const resolved = await client.config.credentials();
   assert.equal(resolved.accessKeyId, 'AKIAEXAMPLE');
});

/**
 * Prompt caching is on, because the expensive half of a chat request never
 * changes: about 6,200 input tokens of tool schemas and instructions, re-sent
 * on every iteration of the agent loop. `auto` is what keeps that safe on a
 * model that cannot cache — the SDK warns and sends the request uncached.
 */
test('a Bedrock model caches the part of the prompt that does not change', () => {
   const config = bedrockModel({
      model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      region: 'us-east-1',
   }).getConfig();
   assert.deepEqual(config.cacheConfig, { strategy: 'auto' });
});

/**
 * The Kilo gateway (ADR-0017): the provider is chosen by the runtime's
 * environment, and a Kilo model is the SDK's OpenAI model pointed at it.
 */

test('the provider is Bedrock unless the environment says Kilo', () => {
   assert.deepEqual(modelProviderFromEnv({}), { provider: 'bedrock' });
   assert.deepEqual(modelProviderFromEnv({ BERRY_MODEL_PROVIDER: 'bedrock' }), { provider: 'bedrock' });
   assert.deepEqual(modelProviderFromEnv({ BERRY_MODEL_PROVIDER: 'kilo', BERRY_KILO_API_KEY: ' k ' }), {
      provider: 'kilo',
      kilo: { apiKey: 'k', baseUrl: DEFAULT_KILO_BASE_URL },
   });
   assert.deepEqual(
      modelProviderFromEnv({ BERRY_MODEL_PROVIDER: 'KILO', BERRY_KILO_API_KEY: 'k', BERRY_KILO_BASE_URL: 'https://gw', BERRY_KILO_ORG_ID: 'org' }),
      { provider: 'kilo', kilo: { apiKey: 'k', baseUrl: 'https://gw', organizationId: 'org' } }
   );
});

test('a Kilo deployment without a key, or an unknown provider, refuses to start', () => {
   assert.throws(() => modelProviderFromEnv({ BERRY_MODEL_PROVIDER: 'kilo' }), /BERRY_KILO_API_KEY/);
   assert.throws(() => modelProviderFromEnv({ BERRY_MODEL_PROVIDER: 'openrouter' }), /must be 'bedrock' or 'kilo'/);
});

test('a Kilo model carries the gateway id, the ceiling and the temperature', () => {
   const model = kiloModel(
      { model: 'anthropic/claude-haiku-4.5', region: 'ignored', maxTokens: 1234, temperature: 0.2 },
      { apiKey: 'k', baseUrl: DEFAULT_KILO_BASE_URL }
   );
   assert.ok(model instanceof OpenAIModel);
   const config = model.getConfig();
   assert.equal(config.modelId, 'anthropic/claude-haiku-4.5');
   assert.equal(config.maxTokens, 1234);
   assert.equal(config.temperature, 0.2);
});

test('a Nova ceiling applies to its gateway id as well as its Bedrock profile', () => {
   const kilo = { apiKey: 'k', baseUrl: DEFAULT_KILO_BASE_URL };
   assert.equal(kiloModel({ model: 'amazon/nova-pro-v1', region: 'r' }, kilo).getConfig().maxTokens, 10_000);
   assert.equal(kiloModel({ model: 'anthropic/claude-sonnet-5', region: 'r' }, kilo).getConfig().maxTokens, DEFAULT_MAX_TOKENS);
});

test('a Kilo model sends the session id, and records the picked model only for a router', async () => {
   const real = globalThis.fetch;
   const headers: Headers[] = [];
   const sse = (served: string) =>
      `data: {"id":"g","model":"${served}","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"}}]}\n\n` +
      `data: {"id":"g","model":"${served}","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],` +
      '"usage":{"prompt_tokens":7,"completion_tokens":1,"is_byok":true,"cost":0,"cost_details":{"upstream_inference_cost":0.00004}}}\n\n' +
      'data: [DONE]\n\n';
   let served = '';
   globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      headers.push(new Headers(init?.headers));
      return new Response(sse(served), { status: 200, headers: { 'content-type': 'text/event-stream' } });
   }) as typeof fetch;
   try {
      const kilo = { apiKey: 'k', baseUrl: 'https://gw.test' };
      const usageOf = async (model: string) => {
         const found: Array<Record<string, unknown>> = [];
         for await (const event of kiloModel({ model, region: 'r', sessionId: 'berry-abc' }, kilo).stream([new Message({ role: 'user', content: [new TextBlock('hi')] })])) {
            if (event.type === 'modelMetadataEvent' && event.usage) found.push(event.usage as unknown as Record<string, unknown>);
         }
         return found;
      };
      served = 'z-ai/glm-5.3-flash';
      const [routed] = await usageOf('kilo-auto/efficient');
      assert.equal(routed?.reportedModel, 'z-ai/glm-5.3-flash');
      assert.equal(routed?.costMicros, 40);
      served = 'anthropic/claude-4.5-haiku-20251001';
      const [fixed] = await usageOf('anthropic/claude-haiku-4.5');
      assert.equal(fixed?.reportedModel, undefined);
      assert.equal(headers[0]?.get('x-kilocode-taskid'), 'berry-abc');
   } finally {
      globalThis.fetch = real;
   }
});

test('a reply that asks for several tools keeps every one of them, not only the last', async () => {
   // As the gateway streams it: two tool calls, one after the other, with the
   // adapter closing neither until the reply ends.
   const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: 'r', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
   const sse =
      chunk({ role: 'assistant' }) +
      chunk({ tool_calls: [{ index: 0, id: 'call-0', type: 'function', function: { name: 'read_skill', arguments: '' } }] }) +
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"name":"a"}' } }] }) +
      chunk({ tool_calls: [{ index: 1, id: 'call-1', type: 'function', function: { name: 'read_skill', arguments: '' } }] }) +
      chunk({ tool_calls: [{ index: 1, function: { arguments: '{"name":"b"}' } }] }) +
      chunk({}, 'tool_calls') +
      'data: [DONE]\n\n';
   const model = new KiloModel([], {
      api: 'chat',
      modelId: 'x-ai/grok-4.7',
      apiKey: 'k',
      clientConfig: {
         baseURL: 'https://gateway.test',
         maxRetries: 0,
         fetch: (async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch,
      },
   });

   const stream = model.streamAggregated([new Message({ role: 'user', content: [new TextBlock('go')] })]);
   let result: IteratorResult<unknown, { message: Message }>;
   do result = await stream.next();
   while (!result.done);
   const calls = result.value.message.content
      .filter((block) => block.type === 'toolUseBlock')
      .map((block) => [(block as { toolUseId: string }).toolUseId, (block as { input: unknown }).input]);
   assert.deepEqual(calls, [['call-0', { name: 'a' }], ['call-1', { name: 'b' }]]);
});
