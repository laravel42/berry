import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import { SESSION_LABEL, containerName, dockerContainers, runArgs } from './docker-containers.ts';
import { SESSION_HEADER, SessionRouter, validSession, type SessionContainers } from './router.ts';

const A = 'berry-' + 'a'.repeat(64);
const B = 'berry-' + 'b'.repeat(64);
const C = 'berry-' + 'c'.repeat(64);
const open: Server[] = [];
after(() => open.forEach((server) => server.close()));

const listen = (server: Server): Promise<string> =>
   new Promise((resolve) => {
      open.push(server);
      server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
   });

/** Stand-in containers: one small HTTP server per session, which says which session it is. */
function fakeContainers(): SessionContainers & { started: string[]; stopped: string[] } {
   const origins = new Map<string, string>();
   const started: string[] = [];
   const stopped: string[] = [];
   return {
      started,
      stopped,
      async ensure(session) {
         let origin = origins.get(session);
         if (!origin) {
            started.push(session);
            origin = await listen(
               createServer((request, response) => {
                  let body = '';
                  request.on('data', (chunk) => (body += chunk));
                  request.on('end', () => {
                     response.writeHead(200, { 'content-type': 'text/event-stream' });
                     response.write(`data: ${JSON.stringify({ session, path: request.url, auth: request.headers.authorization, body })}\n\n`);
                     response.end();
                  });
               })
            );
            origins.set(session, origin);
         }
         return origin;
      },
      async stop(session) {
         stopped.push(session);
         origins.delete(session);
      },
      async running() {
         return [];
      },
   };
}

const invoke = (origin: string, session: string | null, body = '{"x":1}') =>
   fetch(`${origin}/invocations`, {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json', ...(session ? { [SESSION_HEADER]: session } : {}) },
      body,
   });

test('only ids shaped like the ones Berry mints become containers and folders', () => {
   assert.equal(validSession(A), true);
   for (const bad of ['', 'short', '../../etc', 'berry-' + 'a'.repeat(64) + '/..', 'a b'.repeat(10), undefined, ['x']]) {
      assert.equal(validSession(bad), false);
   }
});

test('each session is served by its own container, with the request passed through untouched', async () => {
   const containers = fakeContainers();
   const origin = await listen(new SessionRouter({ containers }).server());
   const [a, b, again] = [await invoke(origin, A), await invoke(origin, B, '{"y":2}'), await invoke(origin, A)];
   const parse = async (response: Response) => JSON.parse((await response.text()).replace(/^data: /, ''));
   assert.equal(a.headers.get('content-type'), 'text/event-stream');
   assert.deepEqual(await parse(a), { session: A, path: '/invocations', auth: 'Bearer token', body: '{"x":1}' });
   assert.deepEqual((await parse(b)).session, B);
   assert.deepEqual((await parse(again)).session, A);
   assert.deepEqual(containers.started, [A, B]);
});

test('a request without a usable session id is refused and starts nothing', async () => {
   const containers = fakeContainers();
   const origin = await listen(new SessionRouter({ containers }).server());
   assert.equal((await invoke(origin, null)).status, 400);
   assert.equal((await invoke(origin, '../../etc/passwd-and-more')).status, 400);
   assert.deepEqual(containers.started, []);
});

test('requests arriving together for one session start one container', async () => {
   const containers = fakeContainers();
   const origin = await listen(new SessionRouter({ containers }).server());
   await Promise.all(Array.from({ length: 6 }, () => invoke(origin, A).then((r) => r.text())));
   assert.deepEqual(containers.started, [A]);
});

test('an idle session loses its container; one that is recent keeps it', async () => {
   const containers = fakeContainers();
   let now = 0;
   const router = new SessionRouter({ containers, idleMs: 1000, clock: () => now });
   const origin = await listen(router.server());
   await (await invoke(origin, A)).text();
   now = 900;
   await (await invoke(origin, B)).text();
   now = 1500;
   assert.equal(await router.reap(), 1);
   assert.deepEqual(containers.stopped, [A]);
});

test('over the cap, the longest-idle container makes room', async () => {
   const containers = fakeContainers();
   let now = 0;
   const router = new SessionRouter({ containers, maxContainers: 2, clock: () => now });
   const origin = await listen(router.server());
   for (const session of [A, B, C]) {
      now += 10;
      await (await invoke(origin, session)).text();
   }
   assert.deepEqual(containers.stopped, [A]);
   assert.equal(router.size, 2);
});

test('the API stopping a session stops its container, and stopping an unknown one starts nothing', async () => {
   const containers = fakeContainers();
   const origin = await listen(new SessionRouter({ containers }).server());
   await (await invoke(origin, A)).text();
   const stop = (session: string) => fetch(`${origin}/sessions/${encodeURIComponent(session)}`, { method: 'DELETE' });
   await (await stop(A)).text();
   assert.deepEqual(containers.stopped, [A]);
   assert.equal((await stop(B)).status, 204);
   assert.deepEqual(containers.started, [A]);
});

test('a stop the container refused, because the caller had no right to it, stops nothing', async () => {
   const stopped: string[] = [];
   const refusing = await listen(createServer((_request, response) => { response.writeHead(401); response.end(); }));
   const containers: SessionContainers = { ensure: async () => refusing, stop: async (session) => void stopped.push(session), running: async () => [] };
   const origin = await listen(new SessionRouter({ containers }).server());
   await (await invoke(origin, A)).text();
   const answer = await fetch(`${origin}/sessions/${A}`, { method: 'DELETE' });
   assert.equal(answer.status, 401);
   assert.deepEqual(stopped, []);
});

test('a session container sees only its own folder, is capped, and runs stripped and isolated', () => {
   const args = runArgs({ image: 'img', volume: 'vol', envFile: '/tmp/e', memory: '2g', cpus: '2', pidsLimit: 2048 }, A);
   const joined = args.join(' ');
   assert.ok(joined.includes(`type=volume,src=vol,dst=/mnt/workspace/${A},volume-subpath=${A}`));
   assert.ok(joined.includes('--publish 127.0.0.1::8080'));
   assert.ok(joined.includes('--cap-drop ALL') && joined.includes('--security-opt no-new-privileges'));
   assert.ok(joined.includes('--memory 2g') && joined.includes('--cpus 2') && joined.includes('--pids-limit 2048'));
   assert.ok(joined.includes('BERRY_RUNTIME_ISOLATE_SESSIONS=true') && joined.includes(`${SESSION_LABEL}=${A}`));
   // Never the whole volume, and never the host's env beyond the filtered file.
   assert.ok(!joined.includes('vol:/mnt/workspace') && args.filter((arg) => arg === '--env-file').length === 1);
   assert.match(containerName(A), /^berry-rt-[0-9a-f]{24}$/);
   assert.notEqual(containerName(A), containerName(B));
});

test('a running container is reused; a missing one gets its folder made, then is started and awaited', async () => {
   const calls: string[][] = [];
   let up = false;
   const docker = async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'port') {
         if (!up) throw new Error('no such container');
         return '127.0.0.1:49153\n';
      }
      if (args[0] === 'run' && args.includes('--detach')) up = true;
      return '';
   };
   const pinged: string[] = [];
   const fakeFetch = (async (url: string) => (pinged.push(String(url)), new Response('{}', { status: 200 }))) as unknown as typeof fetch;
   const containers = dockerContainers({ image: 'img', volume: 'vol', envFile: '/tmp/e', memory: '1g', cpus: '1', pidsLimit: 10, docker, fetch: fakeFetch });
   assert.equal(await containers.ensure(A), 'http://127.0.0.1:49153');
   assert.deepEqual(calls.map((args) => (args[0] === 'run' ? (args.includes('--detach') ? 'run' : 'mkdir') : args[0])), ['port', 'mkdir', 'rm', 'run', 'port']);
   assert.ok(calls[1]!.join(' ').endsWith(`-p /w/${A}`));
   calls.length = 0;
   assert.equal(await containers.ensure(A), 'http://127.0.0.1:49153');
   assert.deepEqual(calls.map((args) => args[0]), ['port']);
   assert.deepEqual(pinged, ['http://127.0.0.1:49153/ping', 'http://127.0.0.1:49153/ping']);
});
