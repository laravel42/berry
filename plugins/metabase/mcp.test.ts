import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMcp, readPluginManifest, resolveServer } from './mcp.ts';

function methodOf(call: { init: RequestInit }): string | undefined {
   if (typeof call.init.body !== 'string') return undefined;
   return (JSON.parse(call.init.body) as { method?: string }).method;
}

function sampleConfig(manifest: ReturnType<typeof readPluginManifest>): Record<string, string> {
   const config: Record<string, string> = {};
   for (const field of manifest.config) {
      if (field.type === 'array') config[field.key] = field.options?.[0] ?? '';
      if (field.type === 'string') config[field.key] = 'value';
   }
   return config;
}

function fakeMcp(): { fetchImpl: typeof fetch; calls: { url: string; init: RequestInit }[] } {
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
   return { fetchImpl, calls };
}

test('tools/list calls the MCP server resolved from the installation', async () => {
   const manifest = readPluginManifest();
   const config = sampleConfig(manifest);
   const { fetchImpl, calls } = fakeMcp();
   const response = await handleMcp({
      authorization: 'Bearer berry_plg_test',
      apiUrl: 'https://berry.example.com',
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      fetchImpl,
   });
   assert.equal(response.status, 200);
   const listed = calls.find((call) => methodOf(call) === 'tools/list');
   const url = resolveServer(manifest, config);
   assert.equal(listed?.url, url);
   const servers = manifest.mcp?.servers ?? {};
   const selector = manifest.config.find((field) => field.type === 'array');
   const selectedKey = selector ? config[selector.key] : Object.keys(servers)[0];
   const template = selectedKey === undefined ? undefined : servers[selectedKey];
   if (template?.includes('{')) {
      assert.equal(url.includes(encodeURIComponent('value')), true);
      assert.equal(url.includes('{'), false);
   }
   assert.equal(new Headers(listed?.init.headers).get('authorization'), 'Bearer secret');
});

test('a bearer token that is not a plugin token is refused', async () => {
   const response = await handleMcp({
      authorization: 'Bearer berry_pat_nope',
      apiUrl: 'https://berry.example.com',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
   });
   assert.equal(response.status, 401);
});
