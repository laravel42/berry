import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
   resumeRequestSchema,
   runtimeControlRequestSchema,
   taskEnvelopeSchema,
} from '../../../runtime/envelope.ts';
import { encodeLifecycle } from '../../../runtime/lifecycle.ts';
import { handleInvocation, type HandlerDeps } from './handler.ts';
import { RunJournals } from './journal.ts';
import { handleRuntimeControl } from '../adapters/control.ts';

/**
 * The AgentCore Runtime service contract: `GET /ping` and `POST /invocations`
 * on 0.0.0.0:8080.
 *
 * `/ping` is how AgentCore decides whether the microVM is idle: `HealthyBusy`
 * while any loop works keeps it from being reaped after the invoke stream has
 * closed. `/invocations` answers with the lifecycle stream and keeps working
 * if the caller goes away. Every frame is journalled, so a caller that comes
 * back — the API after a restart — asks for the rest with a resume request on
 * the same path and records the run as if it had never left.
 */

const SESSION_HEADER = 'x-amzn-bedrock-agentcore-runtime-session-id';
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const KEEPALIVE_MS = 15_000;

export function createRuntimeServer(
   deps: HandlerDeps & {
      localControl?: boolean;
      authMode?: 'agentcore' | 'token';
      authToken?: string;
      /** Pins a local-router container to the one principal/session it was created for. */
      expectedSession?: string;
      journals?: RunJournals;
   }
): Server {
   if (deps.authMode !== 'agentcore' && (!deps.authToken || deps.authToken.length < 32)) {
      throw new Error('Standalone runtime requires BERRY_RUNTIME_AUTH_TOKEN with at least 32 characters');
   }
   const journals = deps.journals ?? new RunJournals();
   let lastUpdate = Math.floor(Date.now() / 1000);
   const touch = () => {
      lastUpdate = Math.floor(Date.now() / 1000);
   };

   return createServer((request, response) => {
      const path = (request.url ?? '/').split('?')[0] ?? '/';
      const reply = (status: number, body: unknown) => {
         const payload = JSON.stringify(body);
         response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
         response.end(payload);
      };

      if (request.method === 'GET' && path === '/ping') {
         return reply(200, { status: deps.registry.busy ? 'HealthyBusy' : 'Healthy', time_of_last_update: lastUpdate });
      }

      if (deps.authMode !== 'agentcore') {
         const expected = createHash('sha256').update(`Bearer ${deps.authToken}`).digest();
         const actual = createHash('sha256').update(request.headers.authorization ?? '').digest();
         if (!timingSafeEqual(expected, actual)) return reply(401, { error: 'runtime authentication required' });
      }

      if (deps.localControl && request.method === 'DELETE' && path.startsWith('/sessions/')) {
         let session: string;
         try { session = decodeURIComponent(path.slice('/sessions/'.length)); }
         catch { return reply(400, { error: 'invalid session path' }); }
         if (deps.expectedSession && session !== deps.expectedSession) {
            return reply(403, { error: 'this container belongs to another runtime session' });
         }
         const stopped = deps.registry.stop(session);
         response.writeHead(stopped ? 204 : 404).end();
         return;
      }

      if (request.method === 'POST' && path === '/invocations') {
         void readBody(request)
            .then((raw) => {
               let parsedJson: unknown;
               try {
                  parsedJson = JSON.parse(raw);
               } catch {
                  return reply(400, { error: 'the body is not JSON' });
               }
               if (parsedJson && typeof parsedJson === 'object' && 'control' in parsedJson) {
                  const control = runtimeControlRequestSchema.safeParse(parsedJson);
                  if (!control.success) return reply(400, { error: 'the runtime control request is not valid' });
                  const header = request.headers[SESSION_HEADER];
                  if (
                     typeof header === 'string' &&
                     header !== control.data.control.runtimeSessionId
                  ) {
                     return reply(400, { error: 'the session header does not match the request' });
                  }
                  if (
                     deps.expectedSession &&
                     control.data.control.runtimeSessionId !== deps.expectedSession
                  ) {
                     return reply(403, { error: 'this container belongs to another runtime session' });
                  }
                  void handleRuntimeControl(deps.adapters, control.data.control).then(
                     (result) => reply(200, result),
                     () => reply(500, {
                        ok: false,
                        error: {
                           code: 'RUNTIME_ERROR',
                           message: 'The runtime control operation failed.',
                           retryable: true,
                        },
                     })
                  );
                  return;
               }
               if (parsedJson && typeof parsedJson === 'object' && 'resume' in parsedJson) {
                  const resume = resumeRequestSchema.safeParse(parsedJson);
                  if (!resume.success) return reply(400, { error: 'the resume request is not valid' });
                  const { runId, runtimeSessionId, after } = resume.data.resume;
                  const header = request.headers[SESSION_HEADER];
                  if (typeof header === 'string' && header !== runtimeSessionId) {
                     return reply(400, { error: 'the session header does not match the request' });
                  }
                  if (deps.expectedSession && runtimeSessionId !== deps.expectedSession) {
                     return reply(403, { error: 'this container belongs to another runtime session' });
                  }
                  let opened = false;
                  const open = () => {
                     if (opened) return;
                     opened = true;
                     response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
                  };
                  const keepalive = setInterval(() => {
                     if (opened && !response.writableEnded && !response.destroyed) response.write(': keepalive\n\n');
                  }, KEEPALIVE_MS);
                  keepalive.unref();
                  const followed = journals.follow(runId, runtimeSessionId, after, {
                     frame: (frame) => {
                        open();
                        if (!response.writableEnded && !response.destroyed) response.write(frame);
                     },
                     end: () => {
                        clearInterval(keepalive);
                        open();
                        if (!response.writableEnded && !response.destroyed) response.end();
                     },
                  });
                  if (followed.kind !== 'following') {
                     clearInterval(keepalive);
                     return followed.kind === 'missing'
                        ? reply(404, { error: 'this runtime holds no such run' })
                        : reply(409, { error: 'this runtime no longer holds the frames asked for' });
                  }
                  open();
                  response.on('close', () => {
                     clearInterval(keepalive);
                     followed.stop();
                  });
                  return;
               }
               const parsed = taskEnvelopeSchema.safeParse(parsedJson);
               if (!parsed.success) {
                  return reply(400, { error: 'the task envelope is not valid', fields: parsed.error.issues.map((i) => i.path.join('.')) });
               }
               const envelope = parsed.data;
               const header = request.headers[SESSION_HEADER];
               if (typeof header === 'string' && header !== envelope.runtimeSessionId) {
                  return reply(400, { error: 'the session header does not match the envelope' });
               }
               if (deps.expectedSession && envelope.runtimeSessionId !== deps.expectedSession) {
                  return reply(403, { error: 'this container belongs to another runtime session' });
               }
               response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
               const keepalive = setInterval(() => {
                  if (!response.writableEnded && !response.destroyed) response.write(': keepalive\n\n');
               }, KEEPALIVE_MS);
               keepalive.unref();
               touch();
               // The caller hanging up — the API restarting, a dispatcher
               // stopping — ends this invocation. `close` also fires after a
               // normal end, when there is nothing left to stop.
               const caller = new AbortController();
               response.on('close', () => {
                  if (!response.writableFinished) caller.abort();
               });
               journals.open(envelope.runId, envelope.runtimeSessionId);
               void handleInvocation(
                  envelope,
                  (event) => {
                     touch();
                     const frame = encodeLifecycle(event);
                     journals.append(envelope.runId, frame);
                     if (!response.writableEnded && !response.destroyed) response.write(frame);
                  },
                  deps,
                  caller.signal
               ).finally(() => {
                  clearInterval(keepalive);
                  touch();
                  journals.end(envelope.runId);
                  if (!response.writableEnded && !response.destroyed) response.end();
               });
            })
            .catch(() => reply(413, { error: 'the body is too large' }));
         return;
      }

      reply(404, { error: `no route for ${request.method} ${path}` });
   });
}

function readBody(request: IncomingMessage): Promise<string> {
   return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on('data', (chunk: Buffer) => {
         size += chunk.byteLength;
         if (size > MAX_BODY_BYTES) {
            reject(new Error('too large'));
            request.destroy();
            return;
         }
         chunks.push(chunk);
      });
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      request.on('error', reject);
   });
}
