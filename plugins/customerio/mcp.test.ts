import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMcp, readPluginManifest } from './mcp.ts';

function methodOf(call: { init: RequestInit }): string | undefined {
   if (typeof call.init.body !== 'string') return undefined;
   return (JSON.parse(call.init.body) as { method?: string }).method;
}

const UPSTREAM_TOOLS = [
   { name: 'cio_prime', description: 'reference' },
   { name: 'cio_schema', description: 'schema' },
   { name: 'cio_read_api', description: 'read' },
   { name: 'cio_write_api', description: 'write' },
   { name: 'cio_delete_api', description: 'delete' },
   { name: 'cio_skills_list', description: 'skills' },
   { name: 'cio_skills_read', description: 'skill' },
   { name: 'cio_auth_status', description: 'auth' },
];

function fakeCustomerIo(region: string): { fetchImpl: typeof fetch; calls: { url: string; init: RequestInit }[] } {
   const manifest = readPluginManifest();
   const secretName = manifest.config.find((field) => field.type === 'secret')?.key ?? '';
   const configKey = manifest.config.find((field) => field.type !== 'secret')?.key ?? '';
   const calls: { url: string; init: RequestInit }[] = [];
   const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith('/v1/self')) {
         return new Response(JSON.stringify({ config: { [configKey]: region }, secrets: { [secretName]: 'cio-secret' } }), {
            status: 200,
         });
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
         return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: UPSTREAM_TOOLS } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
         });
      }
      if (body.method === 'tools/call') {
         return new Response(JSON.stringify({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'ok' }] } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
         });
      }
      return new Response('{}', { status: 404 });
   };
   return { fetchImpl, calls };
}

test('tools/list returns every tool the Customer.io MCP server lists', async () => {
   const { fetchImpl, calls } = fakeCustomerIo('eu');
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
      UPSTREAM_TOOLS.map((tool) => tool.name)
   );
   const manifest = readPluginManifest();
   assert.equal(calls[1]?.url, manifest.mcp?.servers?.eu);
   assert.equal(new Headers(calls[1]?.init.headers).get('authorization'), 'Bearer cio-secret');
   const listed = calls.find((call) => methodOf(call) === 'tools/list');
   assert.equal(new Headers(listed?.init.headers).get('mcp-session-id'), 'sess-1');
   const opened = calls.find((call) => methodOf(call) === 'initialize');
   const openedBody = JSON.parse(String(opened?.init.body)) as { params: { protocolVersion: string; clientInfo: { name: string } } };
   assert.equal(openedBody.params.protocolVersion, manifest.mcp?.protocolVersion);
   assert.equal(openedBody.params.clientInfo.name, `berry-${manifest.key}`);
});

test('a tool call is forwarded to the Customer.io MCP server', async () => {
   const { fetchImpl, calls } = fakeCustomerIo('us');
   const response = await handleMcp({
      authorization: 'Bearer berry_plg_test',
      apiUrl: 'https://berry.example.com',
      body: JSON.stringify({
         jsonrpc: '2.0',
         id: 3,
         method: 'tools/call',
         params: { name: 'cio_read_api', arguments: { path: '/v1/customers' } },
      }),
      fetchImpl,
   });
   const parsed = JSON.parse(response.body) as { result: { content: { text: string }[] } };
   assert.equal(parsed.result.content[0]?.text, 'ok');
   const forwarded = calls.find((call) => methodOf(call) === 'tools/call');
   const body = JSON.parse(String(forwarded?.init.body)) as { params: { name: string } };
   assert.equal(body.params.name, 'cio_read_api');
   assert.equal(forwarded?.url, readPluginManifest().mcp?.servers?.us);
});

test('a call without a plugin token is refused before any tool runs', async () => {
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

test('a call without the address Berry saved is refused', async () => {
   let called = false;
   const response = await handleMcp({
      authorization: 'Bearer berry_plg_test',
      apiUrl: '',
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'cio_read_api', arguments: {} } }),
      fetchImpl: async () => {
         called = true;
         return new Response('{}');
      },
   });
   const parsed = JSON.parse(response.body) as { result: { isError?: boolean } };
   assert.equal(parsed.result.isError, true);
   assert.equal(called, false);
});
