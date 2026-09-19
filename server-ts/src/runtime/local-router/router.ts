import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * One runtime container per session, for a machine without AgentCore.
 *
 * On AgentCore a session is a microVM: its own filesystem, processes, network
 * and memory, started on the first invocation and reaped when idle. The local
 * stand-in was a single container serving every session at once, which shares
 * all of those. This router gives the local setup the same shape: it listens
 * where the API expects the runtime (`BERRY_AGENT_RUNTIME_URL`), reads the
 * session id AgentCore's own header carries, starts that session's container
 * if it is not up, and passes the request through untouched — the lifecycle
 * stream included. The API and the runtime image are unchanged and unaware.
 *
 * It holds no credentials and reads no bodies: authorisation is the
 * container's, exactly as before.
 */

export const SESSION_HEADER = 'x-amzn-bedrock-agentcore-runtime-session-id';

/** A session id becomes a container name and a directory, so it is held to what Berry mints. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/;

export function validSession(value: unknown): value is string {
   return typeof value === 'string' && SESSION_ID.test(value);
}

/** Starts, finds and stops the container that serves one session. */
export interface SessionContainers {
   /** The origin (`http://127.0.0.1:port`) of the session's container, started and answering. */
   ensure(session: string): Promise<string>;
   stop(session: string): Promise<void>;
   /** Sessions with a container already running, for a router that restarted. */
   running(): Promise<string[]>;
}

export interface RouterOptions {
   containers: SessionContainers;
   /** A session with no request for this long loses its container. Its workspace stays. */
   idleMs?: number;
   /** Above this many containers, the longest-idle one is stopped to make room. Busy ones never are. */
   maxContainers?: number;
   clock?: () => number;
   log?: (message: string, fields?: Record<string, unknown>) => void;
}

interface Tracked {
   active: number;
   lastUsed: number;
}

export class SessionRouter {
   readonly #containers: SessionContainers;
   readonly #idleMs: number;
   readonly #max: number;
   readonly #clock: () => number;
   readonly #log: NonNullable<RouterOptions['log']>;
   readonly #sessions = new Map<string, Tracked>();
   /** One start per session at a time, however many requests arrive together. */
   readonly #starting = new Map<string, Promise<string>>();

   constructor(options: RouterOptions) {
      this.#containers = options.containers;
      // Short on purpose. What follows a run on the same session — a continuation,
      // rework after a review — starts within seconds, and a finished task stops
      // its sessions itself; minutes of idling beyond that only hold memory.
      this.#idleMs = options.idleMs ?? 5 * 60_000;
      this.#max = Math.max(1, options.maxContainers ?? 8);
      this.#clock = options.clock ?? Date.now;
      this.#log = options.log ?? (() => undefined);
   }

   /** Containers left by an earlier router are tracked, so they are reaped rather than orphaned. */
   async adopt(): Promise<void> {
      for (const session of await this.#containers.running()) {
         if (!this.#sessions.has(session)) this.#sessions.set(session, { active: 0, lastUsed: this.#clock() });
      }
   }

   get size(): number {
      return this.#sessions.size;
   }

   server(): Server {
      return createServer((request, response) => {
         this.#handle(request, response).catch((error: unknown) => {
            this.#log('request failed', { error: error instanceof Error ? error.message : String(error) });
            if (!response.headersSent) reply(response, 502, { error: 'the session container could not be reached' });
            else response.destroy();
         });
      });
   }

   async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
      const path = (request.url ?? '/').split('?')[0]!;
      if (request.method === 'GET' && path === '/ping') return reply(response, 200, { status: 'Healthy', sessions: this.#sessions.size });

      let session: unknown = request.headers[SESSION_HEADER];
      if (request.method === 'DELETE' && path.startsWith('/sessions/')) {
         try { session = decodeURIComponent(path.slice('/sessions/'.length)); } catch { session = null; }
      }
      if (!validSession(session)) return reply(response, 400, { error: `a valid ${SESSION_HEADER} is required` });

      // Stopping a session nobody started is done already; no container is started to be told to stop.
      if (request.method === 'DELETE' && !this.#sessions.has(session)) return reply(response, 204, null);

      const tracked = this.#sessions.get(session) ?? { active: 0, lastUsed: this.#clock() };
      this.#sessions.set(session, tracked);
      tracked.active += 1;
      let status: number;
      try {
         const origin = await this.#origin(session);
         status = await proxy(request, response, origin);
      } finally {
         tracked.active -= 1;
         tracked.lastUsed = this.#clock();
      }
      // The router holds no credential, so whether the caller may stop a
      // session is the container's answer: one it refused stops nothing.
      if (request.method === 'DELETE' && status !== 401 && status !== 403) await this.#stop(session, 'stopped by the API');
   }

   #origin(session: string): Promise<string> {
      let starting = this.#starting.get(session);
      if (!starting) {
         starting = this.#makeRoom(session)
            .then(() => this.#containers.ensure(session))
            .finally(() => this.#starting.delete(session));
         this.#starting.set(session, starting);
      }
      return starting;
   }

   /** Stops idle containers, longest-idle first, until this session fits under the cap. */
   async #makeRoom(session: string): Promise<void> {
      const idle = [...this.#sessions.entries()]
         .filter(([key, tracked]) => key !== session && tracked.active === 0 && !this.#starting.has(key))
         .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      while (this.#sessions.size > this.#max && idle.length > 0) {
         await this.#stop(idle.shift()![0], 'made room for another session');
      }
   }

   /** Stops every container idle past the limit. Called on a timer by `main.ts`. */
   async reap(): Promise<number> {
      const cutoff = this.#clock() - this.#idleMs;
      let stopped = 0;
      for (const [session, tracked] of [...this.#sessions.entries()]) {
         if (tracked.active > 0 || tracked.lastUsed > cutoff || this.#starting.has(session)) continue;
         await this.#stop(session, 'idle');
         stopped += 1;
      }
      return stopped;
   }

   async stopAll(): Promise<void> {
      await Promise.all([...this.#sessions.keys()].map((session) => this.#stop(session, 'router shutting down')));
   }

   async #stop(session: string, why: string): Promise<void> {
      this.#sessions.delete(session);
      this.#log('stopping session container', { session, why });
      await this.#containers.stop(session).catch((error: unknown) => {
         this.#log('container did not stop cleanly', { session, error: error instanceof Error ? error.message : String(error) });
      });
   }
}

function reply(response: ServerResponse, status: number, body: unknown): void {
   response.writeHead(status, { 'content-type': 'application/json' });
   response.end(body === null ? '' : JSON.stringify(body));
}

/** The request, byte for byte, to the container; its answer, as it arrives, back. Resolves with the status. */
function proxy(request: IncomingMessage, response: ServerResponse, origin: string): Promise<number> {
   return new Promise((resolve, reject) => {
      const target = new URL(request.url ?? '/', origin);
      const upstream = httpRequest(
         target,
         { method: request.method, headers: { ...request.headers, host: target.host } },
         (answer) => {
            const status = answer.statusCode ?? 502;
            response.writeHead(status, answer.headers);
            answer.pipe(response);
            answer.on('end', () => resolve(status));
            answer.on('error', reject);
         }
      );
      upstream.on('error', reject);
      // The caller leaving is how the API cancels a run: the container must see it leave too.
      response.on('close', () => {
         if (!response.writableEnded) upstream.destroy();
         resolve(response.statusCode);
      });
      request.pipe(upstream);
   });
}
