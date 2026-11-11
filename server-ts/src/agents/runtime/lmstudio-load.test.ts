import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LMSTUDIO_NO_TOKEN } from '../../runtime/envelope.ts';
import {
   LMSTUDIO_AGENT_CONTEXT,
   clearLmStudioContextCache,
   ensureLmStudioContext,
   lmStudioAgentContext,
   lmStudioApiOrigin,
   lmStudioErrorMessage,
} from './lmstudio-load.ts';

test('lmStudioApiOrigin strips the /v1 path', () => {
   assert.equal(lmStudioApiOrigin('http://192.168.0.152:1234/v1'), 'http://192.168.0.152:1234');
});

test('ensureLmStudioContext loads when nothing is loaded', async () => {
   clearLmStudioContextCache();
   const calls: Array<{ url: string; method: string; body?: unknown }> = [];
   const fetchImpl = async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, ...(body !== undefined ? { body } : {}) });
      if (url.endsWith('/api/v1/models') && method === 'GET') {
         return json({
            models: [
               {
                  key: 'deepseek-r1-0528-qwen3-8b',
                  max_context_length: 131_072,
                  loaded_instances: [],
               },
            ],
         });
      }
      if (url.endsWith('/api/v1/models/load')) {
         return json({
            status: 'loaded',
            load_config: { context_length: LMSTUDIO_AGENT_CONTEXT },
         });
      }
      return json({}, 404);
   };

   const loaded = await ensureLmStudioContext({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'deepseek-r1-0528-qwen3-8b',
      token: LMSTUDIO_NO_TOKEN,
      fetchImpl,
   });
   assert.equal(loaded, LMSTUDIO_AGENT_CONTEXT);
   assert.equal(calls.some((call) => call.url.endsWith('/api/v1/models/unload')), false);
   const load = calls.find((call) => call.url.endsWith('/api/v1/models/load'));
   assert.deepEqual(load?.body, {
      model: 'deepseek-r1-0528-qwen3-8b',
      context_length: LMSTUDIO_AGENT_CONTEXT,
      echo_load_config: true,
   });
});

test('ensureLmStudioContext skips load when an instance already has enough context', async () => {
   clearLmStudioContextCache();
   const calls: string[] = [];
   const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return json({
         models: [
            {
               key: 'm',
               max_context_length: 131_072,
               loaded_instances: [{ id: 'm', config: { context_length: LMSTUDIO_AGENT_CONTEXT } }],
            },
         ],
      });
   };

   const loaded = await ensureLmStudioContext({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'm',
      token: LMSTUDIO_NO_TOKEN,
      fetchImpl,
   });
   assert.equal(loaded, LMSTUDIO_AGENT_CONTEXT);
   assert.deepEqual(calls, ['GET http://127.0.0.1:1234/api/v1/models']);
});

test('ensureLmStudioContext unloads a too-small instance before reloading', async () => {
   clearLmStudioContextCache();
   const calls: Array<{ url: string; body?: unknown }> = [];
   const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, ...(body !== undefined ? { body } : {}) });
      if (url.endsWith('/api/v1/models') && (init?.method ?? 'GET') === 'GET') {
         return json({
            models: [
               {
                  key: 'm',
                  max_context_length: 65_536,
                  loaded_instances: [{ id: 'm', config: { context_length: 8192 } }],
               },
            ],
         });
      }
      if (url.endsWith('/unload')) return json({ instance_id: 'm' });
      if (url.endsWith('/load')) return json({ load_config: { context_length: LMSTUDIO_AGENT_CONTEXT } });
      return json({}, 404);
   };

   const loaded = await ensureLmStudioContext({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'm',
      token: LMSTUDIO_NO_TOKEN,
      fetchImpl,
   });
   assert.equal(loaded, LMSTUDIO_AGENT_CONTEXT);
   assert.deepEqual(
      calls.map((call) => call.url.replace('http://127.0.0.1:1234', '')),
      ['/api/v1/models', '/api/v1/models/unload', '/api/v1/models/load']
   );
   assert.deepEqual(calls[1]?.body, { instance_id: 'm' });
});

test('ensureLmStudioContext clamps to the model maximum', async () => {
   clearLmStudioContextCache();
   const fetchImpl = async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
         return json({
            models: [{ key: 'tiny', max_context_length: 4096, loaded_instances: [] }],
         });
      }
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      assert.equal(body.context_length, 4096);
      return json({ load_config: { context_length: 4096 } });
   };

   const loaded = await ensureLmStudioContext({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'tiny',
      token: LMSTUDIO_NO_TOKEN,
      fetchImpl,
   });
   assert.equal(loaded, 4096);
});

test('lmStudioErrorMessage unwraps the engine error LM Studio nests in a string', () => {
   // Captured from LM Studio 0.4 when a prompt overflows the loaded context.
   const body = {
      error:
         'Engine protocol predict request returned 400: {"error":{"code":400,"message":"request (20016 tokens) exceeds the available context size (16384 tokens), try increasing it","type":"exceed_context_size_error","n_prompt_tokens":20016,"n_ctx":16384}}',
   };
   assert.equal(
      lmStudioErrorMessage(body),
      'request (20016 tokens) exceeds the available context size (16384 tokens), try increasing it'
   );
   assert.equal(lmStudioErrorMessage({ error: 'Model not found' }), 'Model not found');
   assert.equal(lmStudioErrorMessage({ error: { message: 'bad' } }), 'bad');
   assert.equal(lmStudioErrorMessage({}), null);
});

test('lmStudioAgentContext reads BERRY_LMSTUDIO_CONTEXT and ignores nonsense', () => {
   assert.equal(lmStudioAgentContext({}), LMSTUDIO_AGENT_CONTEXT);
   assert.equal(lmStudioAgentContext({ BERRY_LMSTUDIO_CONTEXT: '32768' }), 32_768);
   assert.equal(lmStudioAgentContext({ BERRY_LMSTUDIO_CONTEXT: 'lots' }), LMSTUDIO_AGENT_CONTEXT);
   assert.equal(lmStudioAgentContext({ BERRY_LMSTUDIO_CONTEXT: '10' }), LMSTUDIO_AGENT_CONTEXT);
});

test('ensureLmStudioContext halves a context that does not fit, and remembers what loaded', async () => {
   clearLmStudioContextCache();
   const tried: number[] = [];
   let lists = 0;
   const fetchImpl = async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
         lists += 1;
         return json({ models: [{ key: 'big', max_context_length: 262_144, loaded_instances: [] }] });
      }
      if (url.endsWith('/api/v1/models/unload')) return json({});
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      tried.push(body.context_length);
      if (body.context_length > 32_768) return json({ error: 'Not enough memory to load the model' }, 500);
      return json({ load_config: { context_length: body.context_length } });
   };

   const first = await ensureLmStudioContext({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'big',
      token: LMSTUDIO_NO_TOKEN,
      fetchImpl,
      contextLength: 65_536,
   });
   assert.equal(first, 32_768);
   assert.deepEqual(tried, [65_536, 32_768]);

   // The next turn asks for the same size: no second round of loads.
   const second = await ensureLmStudioContext({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'big',
      token: LMSTUDIO_NO_TOKEN,
      fetchImpl,
      contextLength: 65_536,
   });
   assert.equal(second, 32_768);
   assert.equal(lists, 1);
   assert.deepEqual(tried, [65_536, 32_768]);
});

function json(body: unknown, status = 200): Response {
   return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
   });
}
