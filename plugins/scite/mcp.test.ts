import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

function sdkInstalled(start: string): boolean {
   let dir = start;
   while (true) {
      if (existsSync(join(dir, 'node_modules/@berry/plugin-sdk'))) return true;
      const parent = dirname(dir);
      if (parent === dir) return false;
      dir = parent;
   }
}

const skip = sdkInstalled(dirname(fileURLToPath(import.meta.url))) ? false : 'node_modules/@berry/plugin-sdk is absent';

function methodOf(call: { init: RequestInit }): string | undefined {
   if (typeof call.init.body !== 'string') return undefined;
   return (JSON.parse(call.init.body) as { method?: string }).method;
}

test('tools/list calls the MCP server named in the manifest', { skip }, async () => {
   const { handleMcp, readPluginManifest, resolveServer } = await import('./mcp.ts');
   const manifest = readPluginManifest();
   const config: Record<string, unknown> = {};
   const secrets: Record<string, string> = {};
   let hasSecret = false;
   for (const field of manifest.config) {
      if (field.type === 'secret') {
         secrets[field.key] = 'secret';
         hasSecret = true;
         continue;
      }
      config[field.key] = field.type === 'array' ? (field.options?.[0] ?? 'value') : 'value';
   }
   const calls: { url: string; init: RequestInit }[] = [];
   const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith('/v1/self')) {
         return new Response(JSON.stringify({ config, secrets }), { status: 200 });
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
   assert.equal(new Headers(listed?.init.headers).get('authorization'), hasSecret ? 'Bearer secret' : null);
   assert.equal(new Headers(listed?.init.headers).get('mcp-session-id'), 'sess-1');
});

test('a call without a plugin token is refused', { skip }, async () => {
   const { handleMcp } = await import('./mcp.ts');
   let called = false;
   const response = await handleMcp({
      authorization: 'Bearer berry_pat_nope',
      apiUrl: 'https://berry.example.com',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      fetchImpl: async () => {
         called = true;
         return new Response('{}');
      },
   });
   assert.equal(response.status, 401);
   assert.equal(called, false);
});
