import {
   CreateMicrovmAuthTokenCommand,
   GetMicrovmCommand,
   GetMicrovmImageCommand,
   LambdaMicrovmsClient,
   RunMicrovmCommand,
   TerminateMicrovmCommand,
} from '@aws-sdk/client-lambda-microvms';
import { randomUUID } from 'node:crypto';
import type { Sql } from '../db/pool.ts';
import { runtimeControlResponseSchema, type RuntimeControlResponse } from './envelope.ts';
import { parseLifecycleStream, type LifecycleEvent } from './lifecycle.ts';
import {
   guardIdle,
   RunNotResumable,
   RuntimeUnavailable,
   STREAM_IDLE_MS,
   type RuntimeTransport,
} from './transport.ts';

/**
 * Agent runs on AWS Lambda MicroVMs: one Firecracker VM per runtime session.
 *
 * The VM runs the ordinary runtime image, so the wire contract is the HTTP
 * transport's (`POST /invocations` answering lifecycle SSE, `/ping`). What
 * differs is who holds the session: AWS starts a VM per session and gives it
 * its own HTTPS endpoint, reached with a short-lived proxy token Berry mints
 * with its own AWS credentials. That token is the only way in, so the image
 * runs in `agentcore` auth mode, as it does behind AgentCore's SigV4.
 *
 * Berry records which VM holds which session (`runtime_microvms`), because AWS
 * keeps no name on a VM: every server, and this one after a restart, sends a
 * session's next turn to the VM that already holds its workspace. A VM AWS has
 * ended (idle past its suspended window, or the 8 hour lifetime) is replaced
 * on next use; the envelope carries the transcript, so the new VM starts warm.
 */

const SESSION_HEADER = 'x-amzn-bedrock-agentcore-runtime-session-id';
/** The runtime image listens here; it is also the proxy's default port. */
const RUNTIME_PORT = 8080;
/** The longest a proxy token may live. */
const TOKEN_MINUTES = 60;
/** A cached token is replaced this long before it expires. */
const TOKEN_MARGIN_MS = 5 * 60_000;
/** AWS's ceiling on a MicroVM's lifetime. */
const MAX_LIFETIME_SECONDS = 28_800;

export interface MicrovmSettings {
   region: string;
   /** The MicroVM image the runtime was built into (`microvm-image:<name>` ARN). */
   imageArn: string;
   /** A `major.minor` version; null runs the image's active version. */
   imageVersion: string | null;
   /** What the guest's AWS SDK and log shipping run as; null runs without one. */
   executionRoleArn: string | null;
   /** No proxy traffic for this long suspends the VM. At least 60. */
   idleSeconds: number;
   /** A suspended VM is terminated after this long. */
   suspendedSeconds: number;
   /** Where the guest's stdout goes; null leaves it to the service default. */
   logGroup: string | null;
}

/** The four MicroVM operations the transport needs, so tests can stand in for AWS. */
export interface MicrovmApi {
   run(settings: MicrovmSettings, runtimeSessionId: string): Promise<{ microvmId: string; endpoint: string }>;
   /** The VM's state, or null when AWS no longer knows it. */
   state(microvmId: string): Promise<string | null>;
   token(microvmId: string, minutes: number): Promise<string>;
   terminate(microvmId: string): Promise<void>;
   /** The image's state and its newest active version. */
   image(imageArn: string): Promise<{ state: string | null; activeVersion: string | null }>;
}

export interface MicrovmSession {
   microvmId: string;
   endpoint: string;
}

/** Which VM holds which session, shared by every server. */
export interface MicrovmSessions {
   find(runtimeSessionId: string): Promise<MicrovmSession | null>;
   /** Records `session` unless another server got there first; returns the one that holds it. */
   claim(runtimeSessionId: string, region: string, session: MicrovmSession): Promise<MicrovmSession>;
   touch(runtimeSessionId: string): Promise<void>;
   /** Forgets the pairing, only if it still names `microvmId`. */
   forget(runtimeSessionId: string, microvmId: string): Promise<void>;
}

const GONE = new Set(['TERMINATING', 'TERMINATED']);

/** The SDK behind `MicrovmApi`. */
export function awsMicrovmApi(options: {
   region: string;
   credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | null;
   client?: Pick<LambdaMicrovmsClient, 'send'>;
}): MicrovmApi {
   const client =
      options.client ??
      new LambdaMicrovmsClient({
         region: options.region,
         ...(options.credentials ? { credentials: options.credentials } : {}),
      });
   return {
      async run(settings) {
         const answer = await client.send(
            new RunMicrovmCommand({
               imageIdentifier: settings.imageArn,
               ...(settings.imageVersion ? { imageVersion: settings.imageVersion } : {}),
               ...(settings.executionRoleArn ? { executionRoleArn: settings.executionRoleArn } : {}),
               idlePolicy: {
                  maxIdleDurationSeconds: settings.idleSeconds,
                  suspendedDurationSeconds: settings.suspendedSeconds,
                  // The next turn of a suspended session wakes it by calling it.
                  autoResumeEnabled: true,
               },
               maximumDurationInSeconds: MAX_LIFETIME_SECONDS,
               ...(settings.logGroup ? { logging: { cloudWatch: { logGroup: settings.logGroup } } } : {}),
               // No runHookPayload: AWS refuses one unless the image enables the
               // run hook, and the runtime needs none. Each request names its
               // session in the session header instead.
               clientToken: randomUUID(),
            })
         );
         if (!answer.microvmId || !answer.endpoint) throw new Error('RunMicrovm returned no MicroVM id or endpoint');
         return { microvmId: answer.microvmId, endpoint: answer.endpoint };
      },
      async state(microvmId) {
         try {
            const answer = await client.send(new GetMicrovmCommand({ microvmIdentifier: microvmId }));
            return answer.state ?? null;
         } catch (cause) {
            if (cause instanceof Error && cause.name === 'ResourceNotFoundException') return null;
            throw cause;
         }
      },
      async token(microvmId, minutes) {
         const answer = await client.send(
            new CreateMicrovmAuthTokenCommand({
               microvmIdentifier: microvmId,
               expirationInMinutes: minutes,
               allowedPorts: [{ port: RUNTIME_PORT }],
            })
         );
         const token = answer.authToken?.['X-aws-proxy-auth'];
         if (!token) throw new Error('CreateMicrovmAuthToken returned no proxy token');
         return token;
      },
      async terminate(microvmId) {
         try {
            await client.send(new TerminateMicrovmCommand({ microvmIdentifier: microvmId }));
         } catch (cause) {
            if (cause instanceof Error && cause.name === 'ResourceNotFoundException') return;
            throw cause;
         }
      },
      async image(imageArn) {
         const answer = await client.send(new GetMicrovmImageCommand({ imageIdentifier: imageArn }));
         return { state: answer.state ?? null, activeVersion: answer.latestActiveImageVersion ?? null };
      },
   };
}

/**
 * Whether runs can start: the image is built and has a version to run. It
 * starts no VM, so a health check costs nothing.
 */
export async function microvmHealth(api: MicrovmApi, settings: MicrovmSettings): Promise<void> {
   const image = await api.image(settings.imageArn);
   if (image.state !== 'CREATED') {
      throw new Error(`the MicroVM image is ${image.state ?? 'unknown'}, not CREATED`);
   }
   if (!settings.imageVersion && !image.activeVersion) {
      throw new Error('the MicroVM image has no active version');
   }
}

/** `runtime_microvms` as the session map. */
export function postgresMicrovmSessions(sql: Sql): MicrovmSessions {
   return {
      async find(runtimeSessionId) {
         const rows = await sql<{ microvm_id: string; endpoint: string }[]>`
            SELECT microvm_id, endpoint FROM runtime_microvms WHERE runtime_session_id = ${runtimeSessionId}
         `;
         const row = rows[0];
         return row ? { microvmId: row.microvm_id, endpoint: row.endpoint } : null;
      },
      async claim(runtimeSessionId, region, session) {
         await sql`
            INSERT INTO runtime_microvms (runtime_session_id, microvm_id, endpoint, region)
            VALUES (${runtimeSessionId}, ${session.microvmId}, ${session.endpoint}, ${region})
            ON CONFLICT (runtime_session_id) DO NOTHING
         `;
         const rows = await sql<{ microvm_id: string; endpoint: string }[]>`
            SELECT microvm_id, endpoint FROM runtime_microvms WHERE runtime_session_id = ${runtimeSessionId}
         `;
         const row = rows[0];
         return row ? { microvmId: row.microvm_id, endpoint: row.endpoint } : session;
      },
      async touch(runtimeSessionId) {
         await sql`UPDATE runtime_microvms SET last_used_at = now() WHERE runtime_session_id = ${runtimeSessionId}`;
      },
      async forget(runtimeSessionId, microvmId) {
         await sql`
            DELETE FROM runtime_microvms
            WHERE runtime_session_id = ${runtimeSessionId} AND microvm_id = ${microvmId}
         `;
      },
   };
}

export function microvmTransport(options: {
   settings: MicrovmSettings;
   api: MicrovmApi;
   sessions: MicrovmSessions;
   fetch?: typeof fetch;
   idleMs?: number;
   /** How long a new VM may take to answer `/ping`. */
   readyTimeoutMs?: number;
   clock?: () => number;
   sleep?: (ms: number) => Promise<void>;
}): RuntimeTransport {
   const { settings, api, sessions } = options;
   const doFetch = options.fetch ?? fetch;
   const idleMs = options.idleMs ?? STREAM_IDLE_MS;
   const readyTimeoutMs = options.readyTimeoutMs ?? 90_000;
   const clock = options.clock ?? Date.now;
   const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
   const tokens = new Map<string, { token: string; expiresAt: number }>();
   /** One start per session at a time, however many calls arrive together. */
   const starting = new Map<string, Promise<MicrovmSession>>();

   const base = (endpoint: string) =>
      (/^https:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`).replace(/\/+$/, '');

   const tokenFor = async (microvmId: string): Promise<string> => {
      const cached = tokens.get(microvmId);
      if (cached && cached.expiresAt - TOKEN_MARGIN_MS > clock()) return cached.token;
      const token = await api.token(microvmId, TOKEN_MINUTES);
      tokens.set(microvmId, { token, expiresAt: clock() + TOKEN_MINUTES * 60_000 });
      return token;
   };

   const proxyHeaders = async (session: MicrovmSession, runtimeSessionId: string) => ({
      'x-aws-proxy-auth': await tokenFor(session.microvmId),
      'x-aws-proxy-port': String(RUNTIME_PORT),
      [SESSION_HEADER]: runtimeSessionId,
   });

   /** `/ping` until the runtime answers; a fresh VM restores its snapshot first. */
   const ready = async (session: MicrovmSession, runtimeSessionId: string): Promise<void> => {
      const deadline = clock() + readyTimeoutMs;
      for (;;) {
         const ok = await doFetch(`${base(session.endpoint)}/ping`, {
            headers: await proxyHeaders(session, runtimeSessionId),
            redirect: 'error',
            signal: AbortSignal.timeout(5_000),
         })
            .then((response) => response.ok)
            .catch(() => false);
         if (ok) return;
         if (clock() >= deadline) {
            throw new RuntimeUnavailable(`MicroVM ${session.microvmId} did not answer within ${readyTimeoutMs} ms`);
         }
         await sleep(2_000);
      }
   };

   /** A VM that holds the session and still exists, or null. */
   const existing = async (runtimeSessionId: string): Promise<MicrovmSession | null> => {
      const found = await sessions.find(runtimeSessionId);
      if (!found) return null;
      const state = await api.state(found.microvmId);
      if (state !== null && !GONE.has(state)) return found;
      tokens.delete(found.microvmId);
      await sessions.forget(runtimeSessionId, found.microvmId);
      return null;
   };

   const start = async (runtimeSessionId: string): Promise<MicrovmSession> => {
      const held = await existing(runtimeSessionId);
      if (held) return held;
      const made = await api.run(settings, runtimeSessionId);
      const claimed = await sessions.claim(runtimeSessionId, settings.region, made);
      if (claimed.microvmId !== made.microvmId) {
         // Another server started one for this session at the same moment.
         await api.terminate(made.microvmId).catch(() => undefined);
         await ready(claimed, runtimeSessionId);
         return claimed;
      }
      await ready(made, runtimeSessionId);
      return made;
   };

   const ensure = (runtimeSessionId: string): Promise<MicrovmSession> => {
      let pending = starting.get(runtimeSessionId);
      if (!pending) {
         pending = start(runtimeSessionId).finally(() => starting.delete(runtimeSessionId));
         starting.set(runtimeSessionId, pending);
      }
      return pending;
   };

   const end = async (runtimeSessionId: string): Promise<void> => {
      const found = await sessions.find(runtimeSessionId);
      if (!found) return;
      await api.terminate(found.microvmId);
      tokens.delete(found.microvmId);
      await sessions.forget(runtimeSessionId, found.microvmId);
   };

   const unavailable = (cause: unknown) =>
      cause instanceof RuntimeUnavailable
         ? cause
         : new RuntimeUnavailable(`could not reach the MicroVM: ${cause instanceof Error ? cause.message : String(cause)}`);

   return {
      async *invoke({ envelope, signal, observe }): AsyncIterable<LifecycleEvent> {
         const request = new AbortController();
         const forward = () => request.abort();
         signal.addEventListener('abort', forward, { once: true });
         let response: Response;
         try {
            const session = await ensure(envelope.runtimeSessionId);
            const url = `${base(session.endpoint)}/invocations`;
            const sent = {
               ...(await proxyHeaders(session, envelope.runtimeSessionId)),
               'content-type': 'application/json',
               accept: 'text/event-stream',
            };
            observe?.request({ method: 'POST', url, headers: sent });
            response = await doFetch(url, {
               method: 'POST',
               headers: sent,
               redirect: 'error',
               body: JSON.stringify(envelope),
               signal: request.signal,
            });
            observe?.response({ status: response.status, headers: Object.fromEntries(response.headers) });
            void sessions.touch(envelope.runtimeSessionId).catch(() => undefined);
         } catch (cause) {
            signal.removeEventListener('abort', forward);
            throw unavailable(cause);
         }
         if (!response.ok || !response.body) {
            signal.removeEventListener('abort', forward);
            throw new RuntimeUnavailable(`the MicroVM answered ${response.status}`);
         }
         try {
            yield* parseLifecycleStream(guardIdle(response.body, idleMs, forward));
         } finally {
            signal.removeEventListener('abort', forward);
         }
      },
      async *resume({ runtimeSessionId, runId, after, signal }): AsyncIterable<LifecycleEvent> {
         const request = new AbortController();
         const forward = () => request.abort();
         signal.addEventListener('abort', forward, { once: true });
         let response: Response;
         try {
            // Only the VM that ran it holds the stream; a new one would not.
            const session = await existing(runtimeSessionId);
            if (!session) throw new RunNotResumable('the MicroVM that held this run is gone');
            response = await doFetch(`${base(session.endpoint)}/invocations`, {
               method: 'POST',
               headers: {
                  ...(await proxyHeaders(session, runtimeSessionId)),
                  'content-type': 'application/json',
                  accept: 'text/event-stream',
               },
               redirect: 'error',
               body: JSON.stringify({ resume: { runId, runtimeSessionId, after } }),
               signal: request.signal,
            });
         } catch (cause) {
            signal.removeEventListener('abort', forward);
            if (cause instanceof RunNotResumable) throw cause;
            throw new RunNotResumable(`could not reach the MicroVM: ${cause instanceof Error ? cause.message : String(cause)}`);
         }
         if (!response.ok || !response.body) {
            signal.removeEventListener('abort', forward);
            throw new RunNotResumable(`the MicroVM answered ${response.status}`);
         }
         try {
            yield* parseLifecycleStream(guardIdle(response.body, idleMs, forward));
         } finally {
            signal.removeEventListener('abort', forward);
         }
      },
      async control({ request, signal }): Promise<RuntimeControlResponse> {
         try {
            const session = await ensure(request.runtimeSessionId);
            const response = await doFetch(`${base(session.endpoint)}/invocations`, {
               method: 'POST',
               headers: {
                  ...(await proxyHeaders(session, request.runtimeSessionId)),
                  'content-type': 'application/json',
                  accept: 'application/json',
               },
               redirect: 'error',
               body: JSON.stringify({ control: request }),
               signal,
            });
            if (!response.ok) throw new Error(`the MicroVM answered ${response.status}`);
            const parsed = runtimeControlResponseSchema.safeParse(await response.json().catch(() => null));
            if (!parsed.success) throw new Error('the runtime returned an invalid control response');
            return parsed.data;
         } catch (cause) {
            throw unavailable(cause);
         } finally {
            // A control call gets a VM of its own; it is not a task's session.
            await end(request.runtimeSessionId).catch(() => undefined);
         }
      },
      async stopStrict({ runtimeSessionId }) {
         try {
            await end(runtimeSessionId);
         } catch (cause) {
            throw unavailable(cause);
         }
      },
      async stop({ runtimeSessionId }) {
         await end(runtimeSessionId).catch(() => undefined);
      },
   };
}
