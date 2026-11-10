import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePackage } from './manifest.ts';
import { listUpstreamMcpTools, mcpServerUrl } from './upstream-tools.ts';

const hosted = parsePackage({
   manifest: {
      schemaVersion: 1,
      key: 'adobe',
      name: 'Adobe',
      version: '1.0.0',
      description: 'Adobe',
      config: [],
      mcp: {
         path: '/mcp',
         offer: 'all',
         servers: { default: 'https://run-workflow.adobe.io/mcp' },
      },
   },
}, { container: true });

test('a single server URL is used as written', () => {
   assert.equal(mcpServerUrl(hosted.manifest, {}), 'https://run-workflow.adobe.io/mcp');
});

test('a query on the server URL is kept', () => {
   const pkg = parsePackage({
      manifest: {
         ...hosted.manifest,
         key: 'posthog',
         mcp: { path: '/mcp', offer: 'all', servers: { default: 'https://mcp.posthog.com/mcp?mode=tools' } },
      },
   }, { container: true });
   assert.equal(mcpServerUrl(pkg.manifest, {}), 'https://mcp.posthog.com/mcp?mode=tools');
});

test('the first server choice is used until one is saved', () => {
   const pkg = parsePackage({
      manifest: {
         ...hosted.manifest,
         key: 'amplitude',
         config: [{
            key: 'ENDPOINT',
            label: 'Which MCP server to call',
            type: 'array',
            options: ['us', 'eu'],
            required: true,
         }],
         mcp: {
            path: '/mcp',
            offer: 'all',
            servers: {
               us: 'https://mcp.amplitude.com/mcp',
               eu: 'https://mcp.eu.amplitude.com/mcp',
            },
         },
      },
   }, { container: true });
   assert.equal(mcpServerUrl(pkg.manifest, {}), 'https://mcp.amplitude.com/mcp');
   assert.equal(mcpServerUrl(pkg.manifest, { ENDPOINT: 'eu' }), 'https://mcp.eu.amplitude.com/mcp');
});

test('a placeholder without a saved value is refused', () => {
   const pkg = parsePackage({
      manifest: {
         ...hosted.manifest,
         key: 'omni',
         config: [{ key: 'OMNI_HOST', name: 'Omni host', label: 'Omni host', type: 'string', required: true }],
         mcp: { path: '/mcp', offer: 'all', servers: { default: 'https://{omni-host}/mcp' } },
      },
   }, { container: true });
   assert.throws(() => mcpServerUrl(pkg.manifest, {}), /Omni host/);
   assert.equal(
      mcpServerUrl(pkg.manifest, { OMNI_HOST: 'acme.omniapp.co' }),
      'https://acme.omniapp.co/mcp'
   );
});

test('tools/list reads the tool names from an event stream', async () => {
   const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string };
      if (body.method === 'initialize') {
         return new Response('{}', { status: 200, headers: { 'mcp-session-id': 'sess-1' } });
      }
      if (body.method === 'tools/list') {
         return new Response(
            'event: message\ndata: {"result":{"tools":[{"name":"scrape","description":"Read a page"}]}}\n',
            { status: 200, headers: { 'content-type': 'text/event-stream' } }
         );
      }
      return new Response('', { status: 202 });
   };
   const tools = await listUpstreamMcpTools(
      'https://mcp.example.com/mcp',
      '',
      '2025-03-26',
      'berry-firecrawl',
      fetchImpl
   );
   assert.deepEqual(tools, [{ name: 'scrape', description: 'Read a page' }]);
});

test('a server that requires a bearer says so', async () => {
   const fetchImpl: typeof fetch = async () => new Response('{}', { status: 401 });
   await assert.rejects(
      () => listUpstreamMcpTools('https://mcp.example.com/mcp', '', '2025-03-26', 'berry-adobe', fetchImpl),
      /API key is saved/
   );
});

test('a saved key the server refuses names that rejection', async () => {
   const fetchImpl: typeof fetch = async () => new Response('{}', {
      status: 401,
      headers: {
         'www-authenticate': 'Bearer realm="OAuth", error="invalid_token", error_description="Invalid or expired token"',
      },
   });
   await assert.rejects(
      () => listUpstreamMcpTools('https://mcp.example.com/mcp', 'saved-key', '2025-03-26', 'berry-customerio', fetchImpl),
      /signs in with OAuth/
   );
});
