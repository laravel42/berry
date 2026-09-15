import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { listedMcpTools, loadMcpClients, mcpServerConfigs, mcpToolPermissions } from './mcp-clients.ts';

/**
 * A minimal streamable-HTTP MCP server on loopback, answering in plain JSON.
 * Enough for the Strands client to connect, list and call; it records every
 * tool call so a test can prove an unapproved tool never reached the server.
 */
export async function fakeMcpServer(tools: string[]): Promise<{ url: string; called: string[]; close: () => Promise<void> }> {
   const called: string[] = [];
   const server: Server = createServer((req, res) => {
      if (req.method !== 'POST') {
         res.writeHead(405).end();
         return;
      }
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
         const message = JSON.parse(body) as { id?: number; method: string; params?: Record<string, unknown> };
         if (message.id === undefined) {
            res.writeHead(202).end();
            return;
         }
         let result: unknown;
         if (message.method === 'initialize') {
            result = {
               protocolVersion: message.params?.protocolVersion,
               capabilities: { tools: {} },
               serverInfo: { name: 'fake', version: '1.0.0' },
            };
         } else if (message.method === 'tools/list') {
            result = { tools: tools.map((name) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } })) };
         } else if (message.method === 'tools/call') {
            const name = String(message.params?.name);
            called.push(name);
            result = { content: [{ type: 'text', text: `${name} ran` }] };
         } else {
            result = {};
         }
         res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      });
   });
   await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
   const { port } = server.address() as AddressInfo;
   return {
      url: `http://127.0.0.1:${port}/mcp`,
      called,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
   };
}

test('each server becomes a prefixed, fail-soft MCP config with its transport', () => {
   assert.deepEqual(
      mcpServerConfigs([
         { name: 'docs', url: 'https://d.test/mcp', transport: 'streamable_http', headers: { A: '1' }, allowedTools: null },
         { name: 'old', url: 'https://o.test/sse', transport: 'sse', headers: {}, allowedTools: null },
      ]),
      {
         docs: {
            url: 'https://d.test/mcp',
            transport: 'streamable-http',
            headers: { A: '1' },
            prefix: 'docs',
            continueOnError: true,
         },
         old: { url: 'https://o.test/sse', transport: 'sse', headers: {}, prefix: 'old', continueOnError: true },
      }
   );
});

test('a server with an allowlist exposes exactly those tools, matched whole', () => {
   const configs = mcpServerConfigs([
      {
         name: 'plugin-relay',
         url: 'https://relay.test/mcp',
         transport: 'streamable_http',
         headers: {},
         allowedTools: ['say_hello'],
      },
   ]);
   assert.deepEqual(configs['plugin-relay']?.toolFilters, { allowed: ['^say_hello$'] });
});

test('only allowlisted MCP tools enter the permission table, under their agent-facing names', () => {
   assert.deepEqual(
      mcpToolPermissions([
         { name: 'plugin-relay', url: 'https://r.test/mcp', transport: 'streamable_http', headers: {}, allowedTools: ['say_hello'] },
         { name: 'docs', url: 'https://d.test/mcp', transport: 'streamable_http', headers: {}, allowedTools: null },
      ]),
      { 'plugin-relay_say_hello': null }
   );
});

test('every tool an agent or workspace server lists at load enters the table, under its agent-facing name', async () => {
   const fake = await fakeMcpServer(['lookup', 'search']);
   const servers = [{ name: 'docs', url: fake.url, transport: 'streamable_http' as const, headers: {}, allowedTools: null }];
   const clients = await loadMcpClients(servers);
   try {
      const listed = await listedMcpTools(clients);
      assert.deepEqual(listed, { docs: ['docs_lookup', 'docs_search'] });
      assert.deepEqual(mcpToolPermissions(servers, listed), { docs_lookup: null, docs_search: null });
   } finally {
      await Promise.all(clients.map((client) => client.disconnect().catch(() => undefined)));
      await fake.close();
   }
});

test('a plugin server stays allowlist-only even when its listing names an unapproved tool', () => {
   assert.deepEqual(
      mcpToolPermissions(
         [{ name: 'plugin-relay', url: 'https://r.test/mcp', transport: 'streamable_http', headers: {}, allowedTools: ['say_hello'] }],
         { 'plugin-relay': ['plugin-relay_say_hello', 'plugin-relay_delete_everything'] }
      ),
      { 'plugin-relay_say_hello': null }
   );
});

test('a server that fails to load contributes no permissions', async () => {
   const fake = await fakeMcpServer(['lookup']);
   await fake.close();
   const servers = [{ name: 'dead', url: fake.url, transport: 'streamable_http' as const, headers: {}, allowedTools: null }];
   const clients = await loadMcpClients(servers);
   try {
      const listed = await listedMcpTools(clients);
      assert.deepEqual(listed, { dead: [] });
      assert.deepEqual(mcpToolPermissions(servers, listed), {});
   } finally {
      await Promise.all(clients.map((client) => client.disconnect().catch(() => undefined)));
   }
});

test('an unapproved tool on the same server is never listed to the agent', async () => {
   const fake = await fakeMcpServer(['say_hello', 'delete_everything']);
   const clients = await loadMcpClients([
      { name: 'plugin-relay', url: fake.url, transport: 'streamable_http', headers: {}, allowedTools: ['say_hello'] },
   ]);
   try {
      const listed = (await Promise.all(clients.map((client) => client.listTools()))).flat().map((tool) => tool.name);
      assert.deepEqual(listed, ['plugin-relay_say_hello']);
   } finally {
      await Promise.all(clients.map((client) => client.disconnect().catch(() => undefined)));
      await fake.close();
   }
});

test('no servers means no clients and no connection attempt', async () => {
   assert.deepEqual(await loadMcpClients([]), []);
});

/**
 * A server that accepts the socket but never answers: it reads the request and
 * holds the response open, so the MCP `initialize` handshake never completes.
 * This is the hang loadMcpClients' connect timeout must escape.
 */
async function nonRespondingMcpServer(): Promise<{ url: string; close: () => Promise<void> }> {
   const held: Array<{ req: import('node:http').IncomingMessage; res: import('node:http').ServerResponse }> = [];
   const server: Server = createServer((req, res) => {
      req.on('data', () => undefined);
      req.on('end', () => held.push({ req, res })); // never writes a response
   });
   await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
   const { port } = server.address() as AddressInfo;
   return {
      url: `http://127.0.0.1:${port}/mcp`,
      close: () =>
         new Promise<void>((resolve) => {
            for (const { res } of held) res.destroy();
            server.close(() => resolve());
         }),
   };
}

test('a server that never answers the handshake is dropped within the timeout, fail-soft', async () => {
   const rejections: unknown[] = [];
   const onRejection = (reason: unknown): void => {
      rejections.push(reason);
   };
   process.on('unhandledRejection', onRejection);
   const dead = await nonRespondingMcpServer();
   const warnings: { message: string; fields: Record<string, unknown> }[] = [];
   try {
      const started = Date.now();
      const clients = await loadMcpClients(
         [{ name: 'hung', url: dead.url, transport: 'streamable_http', headers: {}, allowedTools: null }],
         50,
         (message, fields) => warnings.push({ message, fields })
      );
      const elapsed = Date.now() - started;
      // Resolved, not hung: empty client list, well inside a generous bound.
      assert.deepEqual(clients, []);
      assert.ok(elapsed < 5_000, `loadMcpClients took ${elapsed}ms`);
      assert.equal(warnings.length, 1, JSON.stringify(warnings));
      assert.equal(warnings[0]!.fields.server, 'hung');
      // Let any late settle from the abandoned connect surface as a rejection.
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.deepEqual(rejections, []);
   } finally {
      process.off('unhandledRejection', onRejection);
      await dead.close();
   }
});
