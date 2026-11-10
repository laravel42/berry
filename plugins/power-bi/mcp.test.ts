import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMcp, readPluginManifest, resolveServer } from './mcp.ts';

function sampleConfig(manifest: ReturnType<typeof readPluginManifest>): Record<string, string> {
   const config: Record<string, string> = {};
   for (const field of manifest.config) {
      if (field.type === 'array') {
         const option = field.options?.[0];
         if (option) config[field.key] = option;
      } else if (field.type === 'string') {
         config[field.key] = 'value';
      }
   }
   return config;
}

test('tools/list forwards to the MCP server named in the manifest', async () => {
   const manifest = readPluginManifest();
   const config = sampleConfig(manifest);
   const secretName = manifest.config.find((field) => field.type === 'secret')?.key ?? '';
   const calls: { url: string; init: RequestInit }[] = [];
   const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith('/v1/self')) {
         return new Response(JSON.stringify({ config, secrets: { [secretName]: 'secret' } }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string };
      if (body.method === 'initialize') {
         return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), {
            status: 200,
            headers: { 'mcp-session-id': 'sess-1', 'content-type': 'application/json' },
         });
      }
      if (body.method === 'notifications/initialized') return new Response('', { status: 202 });
      if (body.method === 'tools/list') {
         return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'demo' }] } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
         });
      }
      return new Response('{}', { status: 404 });
   };
   const response = await handleMcp({
      authorization: 'Bearer berry_plg_test',
      apiUrl: 'https://berry.example.com',
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      fetchImpl,
   });
   assert.equal(response.status, 200);
   const parsed = JSON.parse(response.body) as { result: { tools: { name: string }[] } };
   assert.deepEqual(
      parsed.result.tools.map((tool) => tool.name),
      ['demo']
   );
   assert.equal(calls[1]?.url, resolveServer(manifest, config));
   assert.equal(new Headers(calls[1]?.init.headers).get('authorization'), 'Bearer secret');
});

test('a call without a plugin token is refused', async () => {
   const response = await handleMcp({
      authorization: 'Bearer berry_pat_nope',
      apiUrl: 'https://berry.example.com',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      fetchImpl: async () => new Response('{}'),
   });
   assert.equal(response.status, 401);
});
