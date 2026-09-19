import { parseLifecycleStream, type LifecycleEvent } from './lifecycle.ts';
import { guardIdle, RuntimeUnavailable, STREAM_IDLE_MS, type RuntimeTransport } from './transport.ts';

const SESSION_HEADER = 'x-amzn-bedrock-agentcore-runtime-session-id';

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
   return {
      async *invoke({ target, envelope, signal, observe }): AsyncIterable<LifecycleEvent> {
         let response: Response;
         // The caller's signal, plus the idle watchdog's: either one ends the request.
         const request = new AbortController();
         const forward = () => request.abort();
         signal.addEventListener('abort', forward, { once: true });
         try {
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
      async stop({ target, runtimeSessionId }) {
         const response = await doFetch(`${base(target.endpointUrl)}/sessions/${encodeURIComponent(runtimeSessionId)}`, {
            method: 'DELETE', headers: headers(target.endpointUrl), redirect: 'error', signal: AbortSignal.timeout(10_000),
         });
         if (!response.ok && response.status !== 404) throw new RuntimeUnavailable(`Runtime stop answered ${response.status}`);
      },
   };
}
