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
