import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiTokenError, listApiTokenModels } from './api-token-runtimes.ts';

const json = (status: number, body: unknown): Response =>
   new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('API token model lists', () => {
   test('reads OpenAI model ids and never puts the token in the error', async () => {
      const secret = 'sk-test-secret-value';
      let authorization = '';
      const models = await listApiTokenModels('openai', secret, async (_url, init) => {
         authorization = new Headers(init.headers).get('authorization') ?? '';
         return json(200, { data: [{ id: 'gpt-4.1' }, { id: 'whisper-1' }, { id: '' }] });
      });
      assert.equal(authorization, `Bearer ${secret}`);
      assert.deepEqual(models.map((model) => model.id), ['gpt-4.1', 'whisper-1']);
      await assert.rejects(
         () => listApiTokenModels('openai', secret, async () => json(401, { error: secret })),
         (error: unknown) => {
            assert.ok(error instanceof ApiTokenError);
            assert.equal(error.code, 'AI_RUNTIME_AUTH_FAILED');
            assert.equal(error.message.includes(secret), false);
            return true;
         }
      );
   });

   test('keeps Gemini generateContent models and drops the models/ prefix', async () => {
      const models = await listApiTokenModels('gemini', 'key', async () =>
         json(200, {
            models: [
               {
                  name: 'models/gemini-2.5-flash',
                  displayName: 'Gemini 2.5 Flash',
                  supportedGenerationMethods: ['generateContent'],
               },
               {
                  name: 'models/embedding-001',
                  displayName: 'Embedding',
                  supportedGenerationMethods: ['embedContent'],
               },
            ],
         })
      );
      assert.deepEqual(models, [{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }]);
   });

   test('uses the Anthropic display name', async () => {
      const models = await listApiTokenModels('anthropic', 'key', async () =>
         json(200, { data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }] })
      );
      assert.deepEqual(models, [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }]);
   });
});

describe('LM Studio model lists', () => {
   const base = 'http://localhost:1234/v1';

   test('reads context length and capabilities from the native model list', async () => {
      let url = '';
      let authorization: string | null = 'unset';
      const models = await listApiTokenModels(
         'lmstudio',
         null,
         async (input, init) => {
            url = input;
            authorization = new Headers(init.headers).get('authorization');
            return json(200, {
               models: [
                  {
                     type: 'llm',
                     key: 'qwen3.8-27b',
                     display_name: 'Qwen3.8 27B',
                     max_context_length: 262144,
                     capabilities: {
                        vision: true,
                        trained_for_tool_use: true,
                        reasoning: { allowed_options: ['off', 'on'], default: 'on' },
                     },
                  },
                  {
                     type: 'llm',
                     key: 'deepseek-r1-0528-qwen3-8b',
                     display_name: 'DeepSeek R1',
                     max_context_length: 131072,
                     capabilities: { vision: false, trained_for_tool_use: false },
                  },
                  { type: 'embedding', key: 'text-embedding-nomic-embed-text-v1.5', display_name: 'Embed' },
               ],
            });
         },
         base
      );
      assert.equal(url, 'http://localhost:1234/api/v1/models');
      assert.equal(authorization, null);
      assert.deepEqual(models, [
         {
            id: 'deepseek-r1-0528-qwen3-8b',
            name: 'DeepSeek R1',
            maxContextLength: 131072,
            capabilities: { vision: false, trainedForToolUse: false },
         },
         {
            id: 'qwen3.8-27b',
            name: 'Qwen3.8 27B',
            maxContextLength: 262144,
            capabilities: {
               vision: true,
               trainedForToolUse: true,
               reasoning: { allowedOptions: ['off', 'on'], default: 'on' },
            },
         },
      ]);
   });

   test('falls back to the OpenAI-compatible list when the native list is missing', async () => {
      const urls: string[] = [];
      const models = await listApiTokenModels(
         'lmstudio',
         null,
         async (input) => {
            urls.push(input);
            if (input.endsWith('/api/v1/models')) return json(404, { error: 'not found' });
            return json(200, {
               data: [
                  { id: 'qwen/qwen3-coder-30b', object: 'model' },
                  { id: 'text-embedding-nomic-embed-text-v1.5', object: 'model' },
                  { id: 'google/gemma-3-12b', object: 'model' },
               ],
            });
         },
         base
      );
      assert.deepEqual(urls, ['http://localhost:1234/api/v1/models', `${base}/models`]);
      assert.deepEqual(models.map((model) => model.id), ['google/gemma-3-12b', 'qwen/qwen3-coder-30b']);
   });

   test('sends the token as a bearer header when one is pasted', async () => {
      let authorization = '';
      await listApiTokenModels(
         'lmstudio',
         'lm-token',
         async (_url, init) => {
            authorization = new Headers(init.headers).get('authorization') ?? '';
            return json(200, {
               models: [{ type: 'llm', key: 'google/gemma-3-12b', display_name: 'Gemma 3 12B' }],
            });
         },
         base
      );
      assert.equal(authorization, 'Bearer lm-token');
   });

   test('says how to fix an unreachable server, a refused token and an empty list', async () => {
      await assert.rejects(
         () => listApiTokenModels('lmstudio', null, async () => { throw new TypeError('fetch failed'); }, base),
         (error: unknown) => {
            assert.ok(error instanceof ApiTokenError);
            assert.equal(error.code, 'AI_RUNTIME_AUTH_UNAVAILABLE');
            assert.match(error.message, /localhost:1234/);
            assert.match(error.message, /lms server start/);
            return true;
         }
      );
      await assert.rejects(
         () => listApiTokenModels('lmstudio', null, async () => json(401, { error: 'unauthorized' }), base),
         (error: unknown) => error instanceof ApiTokenError && error.code === 'AI_RUNTIME_AUTH_FAILED' && /API token/.test(error.message)
      );
      await assert.rejects(
         () => listApiTokenModels('lmstudio', null, async () => json(200, { data: [{ id: 'text-embedding-bge' }] }), base),
         (error: unknown) => error instanceof ApiTokenError && /Download a model/.test(error.message)
      );
   });
});
