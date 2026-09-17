import { parseLifecycleStream, type LifecycleEvent } from './lifecycle.ts';
import { RuntimeUnavailable, type RuntimeTransport } from './transport.ts';

const SESSION_HEADER = 'x-amzn-bedrock-agentcore-runtime-session-id';

/** The runtime image on a URL (the local `agent-runtime` service): same contract, no SigV4. */
export function httpTransport(options: { fetch?: typeof fetch; token?: string | null; endpointUrl?: string | null } = {}): RuntimeTransport {
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
      async *invoke({ target, envelope, signal }): AsyncIterable<LifecycleEvent> {
         let response: Response;
         try {
            response = await doFetch(`${base(target.endpointUrl)}/invocations`, {
               method: 'POST',
               headers: { ...headers(target.endpointUrl), 'content-type': 'application/json', accept: 'text/event-stream', [SESSION_HEADER]: envelope.runtimeSessionId },
               redirect: 'error',
               body: JSON.stringify(envelope),
               signal,
            });
         } catch (cause) {
            throw new RuntimeUnavailable(`could not reach the runtime: ${cause instanceof Error ? cause.message : String(cause)}`);
         }
         if (!response.ok || !response.body) throw new RuntimeUnavailable(`the runtime answered ${response.status}`);
         yield* parseLifecycleStream(response.body);
      },
      async stop({ target, runtimeSessionId }) {
         const response = await doFetch(`${base(target.endpointUrl)}/sessions/${encodeURIComponent(runtimeSessionId)}`, {
            method: 'DELETE', headers: headers(target.endpointUrl), redirect: 'error', signal: AbortSignal.timeout(10_000),
         });
         if (!response.ok && response.status !== 404) throw new RuntimeUnavailable(`Runtime stop answered ${response.status}`);
      },
   };
}
