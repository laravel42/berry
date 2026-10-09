import {
   runtimeControlResponseSchema,
   type RuntimeControlResponse,
} from './envelope.ts';
import { parseLifecycleStream, type LifecycleEvent } from './lifecycle.ts';
import { guardIdle, RunNotResumable, RuntimeUnavailable, STREAM_IDLE_MS, type RuntimeTransport } from './transport.ts';

const SESSION_HEADER = 'x-amzn-bedrock-agentcore-runtime-session-id';

/** OAuth-bearing requests need TLS unless they never leave this host. */
export function credentialSafeRuntimeUrl(raw: string | null): boolean {
   if (!raw) return false;
   try {
      const url = new URL(raw);
      if (url.protocol === 'https:') return true;
      if (url.protocol !== 'http:') return false;
      const host = url.hostname.toLowerCase();
      return host === 'localhost' || host === '::1' || host.startsWith('127.');
   } catch {
      return false;
   }
}

/** The runtime image on a URL (the local `agent-runtime` service): same contract, no SigV4. */
export function httpTransport(
   options: { fetch?: typeof fetch; token?: string | null; endpointUrl?: string | null; idleMs?: number } = {}
): RuntimeTransport {
   const idleMs = options.idleMs ?? STREAM_IDLE_MS;
   const doFetch = options.fetch ?? fetch;
   const base = (url: string | null) => {
      if (!url) throw new RuntimeUnavailable('this runtime has no endpoint URL');
      return url.replace(/\/+$/, '');
   };
   const headers = (url: string | null) => {
      if (!options.token || options.token.length < 32 || base(url) !== base(options.endpointUrl ?? null)) {
         throw new RuntimeUnavailable('No authentication credential is configured for this runtime endpoint');
      }
      return { authorization: `Bearer ${options.token}` };
   };
   const stopSession = async (targetUrl: string | null, runtimeSessionId: string): Promise<void> => {
      const response = await doFetch(
         `${base(targetUrl)}/sessions/${encodeURIComponent(runtimeSessionId)}`,
         {
            method: 'DELETE',
            headers: headers(targetUrl),
            redirect: 'error',
            signal: AbortSignal.timeout(10_000),
         }
      );
      if (!response.ok && response.status !== 404) {
         throw new RuntimeUnavailable(`Runtime stop answered ${response.status}`);
      }
   };
   return {
      async *invoke({ target, envelope, signal, observe }): AsyncIterable<LifecycleEvent> {
         let response: Response;
         // The caller's signal, plus the idle watchdog's: either one ends the request.
         const request = new AbortController();
         const forward = () => request.abort();
         signal.addEventListener('abort', forward, { once: true });
         try {
            if (envelope.runtime && !credentialSafeRuntimeUrl(target.endpointUrl)) {
               throw new RuntimeUnavailable(
                  'A personal AI runtime requires HTTPS, except on this host loopback.'
               );
            }
            const url = `${base(target.endpointUrl)}/invocations`;
            const sent = { ...headers(target.endpointUrl), 'content-type': 'application/json', accept: 'text/event-stream', [SESSION_HEADER]: envelope.runtimeSessionId };
            observe?.request({ method: 'POST', url, headers: sent });
            response = await doFetch(url, {
               method: 'POST',
               headers: sent,
               redirect: 'error',
               body: JSON.stringify(envelope),
               signal: request.signal,
            });
         } catch (cause) {
            throw new RuntimeUnavailable(`could not reach the runtime: ${cause instanceof Error ? cause.message : String(cause)}`);
         }
         observe?.response({ status: response.status, headers: Object.fromEntries(response.headers) });
         if (!response.ok || !response.body) throw new RuntimeUnavailable(`the runtime answered ${response.status}`);
         try {
            yield* parseLifecycleStream(guardIdle(response.body, idleMs, forward));
         } finally {
            signal.removeEventListener('abort', forward);
         }
      },
      async *resume({ target, runtimeSessionId, runId, after, signal }): AsyncIterable<LifecycleEvent> {
         let response: Response;
         const request = new AbortController();
         const forward = () => request.abort();
         signal.addEventListener('abort', forward, { once: true });
         try {
            response = await doFetch(`${base(target.endpointUrl)}/invocations`, {
               method: 'POST',
               headers: { ...headers(target.endpointUrl), 'content-type': 'application/json', accept: 'text/event-stream', [SESSION_HEADER]: runtimeSessionId },
               redirect: 'error',
               body: JSON.stringify({ resume: { runId, runtimeSessionId, after } }),
               signal: request.signal,
            });
         } catch (cause) {
            signal.removeEventListener('abort', forward);
            throw new RunNotResumable(`could not reach the runtime: ${cause instanceof Error ? cause.message : String(cause)}`);
         }
         if (!response.ok || !response.body) {
            signal.removeEventListener('abort', forward);
            throw new RunNotResumable(`the runtime answered ${response.status}`);
         }
         try {
            yield* parseLifecycleStream(guardIdle(response.body, idleMs, forward));
         } finally {
            signal.removeEventListener('abort', forward);
         }
      },
      async control({ target, request, signal }): Promise<RuntimeControlResponse> {
         try {
            if (request.credential && !credentialSafeRuntimeUrl(target.endpointUrl)) {
               throw new RuntimeUnavailable(
                  'A personal AI runtime requires HTTPS, except on this host loopback.'
               );
            }
            const response = await doFetch(`${base(target.endpointUrl)}/invocations`, {
               method: 'POST',
               headers: {
                  ...headers(target.endpointUrl),
                  'content-type': 'application/json',
                  accept: 'application/json',
                  [SESSION_HEADER]: request.runtimeSessionId,
               },
               redirect: 'error',
               body: JSON.stringify({ control: request }),
               signal,
            });
            if (!response.ok) throw new Error(`the runtime answered ${response.status}`);
            const parsed = runtimeControlResponseSchema.safeParse(
               await response.json().catch(() => null)
            );
            if (!parsed.success) throw new Error('the runtime returned an invalid control response');
            return parsed.data;
         } catch (cause) {
            if (cause instanceof RuntimeUnavailable) throw cause;
            throw new RuntimeUnavailable(
               `could not reach the runtime: ${cause instanceof Error ? cause.message : String(cause)}`
            );
         } finally {
            // The local session router gives control calls their own container.
            // Stop it on every outcome; a direct shared runtime may answer 404.
            try {
               await doFetch(
                  `${base(target.endpointUrl)}/sessions/${encodeURIComponent(request.runtimeSessionId)}`,
                  {
                     method: 'DELETE',
                     headers: headers(target.endpointUrl),
                     redirect: 'error',
                     signal: AbortSignal.timeout(10_000),
                  }
               );
            } catch {
               // The control response is still authoritative; cleanup is best effort.
            }
         }
      },
      async stopStrict({ target, runtimeSessionId }) {
         await stopSession(target.endpointUrl, runtimeSessionId);
      },
      async stop({ target, runtimeSessionId }) {
         await stopSession(target.endpointUrl, runtimeSessionId);
      },
   };
}
