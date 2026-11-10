import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMcp, readPluginManifest, resolveServer } from './mcp.ts';

function methodOf(call: { init: RequestInit }): string | undefined {
   if (typeof call.init.body !== 'string') return undefined;
   return (JSON.parse(call.init.body) as { method?: string }).method;
}

function sampleConfig(manifest: ReturnType<typeof readPluginManifest>): Record<string, unknown> {
   const config: Record<string, unknown> = {};
   for (const field of manifest.config) {
      if (field.type === 'array') config[field.key] = field.options?.[0] ?? '';
      else if (field.type === 'string') config[field.key] = 'value';
   }
   return config;
}

test('tools/list calls the MCP server selected for this installation', async () => {
   const manifest = readPluginManifest();
   const config = sampleConfig(manifest);
   const secretField = manifest.config.find((field) => field.type === 'secret');
   const calls: { url: string; init: RequestInit }[] = [];
   const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith('/v1/self')) {
         return new Response(JSON.stringify({
            config,
            secrets: secretField ? { [secretField.key]: 'secret' } : {},
         }), { status: 200 });
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
   const listed = calls.find((call) => methodOf(call) === 'tools/list');
   assert.equal(listed?.url, resolveServer(manifest, config));
   const authorization = new Headers(listed?.init.headers).get('authorization');
   if (secretField) assert.equal(authorization, 'Bearer secret');
   else assert.equal(authorization, null);
});

test('a call without a plugin token is refused before any tool runs', async () => {
   const response = await handleMcp({
      authorization: 'Bearer berry_pat_nope',
      apiUrl: 'https://berry.example.com',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      fetchImpl: async () => new Response('{}'),
   });
   assert.equal(response.status, 401);
});
