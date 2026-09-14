import assert from 'node:assert/strict';
import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { drain } from './drain.ts';

/** A server holding one open event stream, as the Next.js proxy holds /api/v1/events. */
async function serverWithOpenStream(): Promise<Server> {
   const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: hello\n\n');
      // Never ended: a stream stays open until the client leaves.
   });
   await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
   const { port } = server.address() as AddressInfo;
   await new Promise<void>((resolve) => {
      const request = get({ host: '127.0.0.1', port, path: '/' }, (response) => {
         response.on('error', () => {});
         response.once('data', () => resolve());
      });
      request.on('error', () => {});
   });
   return server;
}

test('drain ends even while a client holds a stream open', async () => {
   const server = await serverWithOpenStream();
   const started = Date.now();
   // server.close() alone never calls back here: the stream never ends.
   await drain(server, { graceMs: 200 });
   assert.ok(Date.now() - started < 2_000, 'drain waited on the open stream');
   assert.equal(server.listening, false);
});

test('drain stops accepting new connections at once', async () => {
   const server = await serverWithOpenStream();
   const draining = drain(server, { graceMs: 200 });
   assert.equal(server.listening, false);
   await draining;
});
