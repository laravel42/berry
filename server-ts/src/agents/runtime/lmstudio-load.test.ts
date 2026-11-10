import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LMSTUDIO_NO_TOKEN } from '../../runtime/envelope.ts';
import {
   LMSTUDIO_AGENT_CONTEXT,
   clearLmStudioContextCache,
   ensureLmStudioContext,
   lmStudioApiOrigin,
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

function json(body: unknown, status = 200): Response {
   return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
   });
}
