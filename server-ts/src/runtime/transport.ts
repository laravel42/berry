import type {
   RuntimeControlRequest,
   RuntimeControlResponse,
   TaskEnvelope,
} from './envelope.ts';
import type { LifecycleEvent } from './lifecycle.ts';

/** Where a task runs: an AgentCore Runtime by ARN, or the same image on a URL. */
export interface RuntimeTarget {
   /** The `agent_runtimes` row, or null for the deployment's configured default. */
   id: string | null;
   driver: 'agentcore' | 'http';
   arn: string | null;
   qualifier: string;
   region: string | null;
   endpointUrl: string | null;
}

/** An HTTP message as it crossed the wire; header names lower-cased, values unredacted. */
export interface WireRequest {
   method: string;
   url: string;
   headers: Record<string, string>;
}

export interface WireResponse {
   status: number;
   headers: Record<string, string>;
}

/**
 * Told what an invoke put on the wire and what came back, for the prompt log.
 * Called by the transport, never awaited: observing must not slow or fail a
 * task. Values arrive unredacted; the observer redacts before it keeps them.
 */
export interface ExchangeObserver {
   request(request: WireRequest): void;
   response(response: WireResponse): void;
}

export interface RuntimeTransport {
   invoke(input: {
      target: RuntimeTarget;
      envelope: TaskEnvelope;
      signal: AbortSignal;
      observe?: ExchangeObserver | undefined;
   }): AsyncIterable<LifecycleEvent>;
   /**
    * The rest of a run's stream, after the first `after` frames, from a runtime
    * still holding it. Throws `RunNotResumable` when it is not.
    */
   resume?(input: {
      target: RuntimeTarget;
      runtimeSessionId: string;
      runId: string;
      after: number;
      signal: AbortSignal;
   }): AsyncIterable<LifecycleEvent>;
   /** Ends the session. Never throws: a session already gone is the goal. */
   stop(input: { target: RuntimeTarget; runtimeSessionId: string }): Promise<void>;
   /** Ends a session and reports transport failure to an explicit disconnect flow. */
   stopStrict?(input: { target: RuntimeTarget; runtimeSessionId: string }): Promise<void>;
   /** Adapter availability, account, and model discovery without starting a task. */
   control?(input: {
      target: RuntimeTarget;
      request: RuntimeControlRequest;
      signal: AbortSignal;
   }): Promise<RuntimeControlResponse>;
}

/** The runtime could not be reached or refused the invoke. Always retryable. */
export class RuntimeUnavailable extends Error {
   override readonly name = 'RuntimeUnavailable';
   readonly retryable = true;
}

/**
 * The runtime does not hold the run any more: it was reaped, restarted, or
 * kept only newer frames. Nothing was read, so the run is abandoned as before.
 */
export class RunNotResumable extends Error {
   override readonly name = 'RunNotResumable';
}

export function routingTransport(transports: { agentcore: RuntimeTransport | null; http: RuntimeTransport }): RuntimeTransport {
   const pick = (target: RuntimeTarget): RuntimeTransport => {
      if (target.driver === 'http') return transports.http;
      if (!transports.agentcore) throw new RuntimeUnavailable('no AgentCore credentials or region are configured');
      return transports.agentcore;
   };
   return {
      invoke: (input) => pick(input.target).invoke(input),
      resume: (input) => {
         const transport = pick(input.target);
         if (!transport.resume) throw new RunNotResumable('this transport cannot resume a run');
         return transport.resume(input);
      },
      control: (input) => {
         const transport = pick(input.target);
         if (!transport.control) {
            throw new RuntimeUnavailable('this runtime transport cannot perform adapter control operations');
         }
         return transport.control(input);
      },
      stopStrict: async (input) => {
         const transport = pick(input.target);
         if (!transport.stopStrict) {
            throw new RuntimeUnavailable('this runtime transport cannot confirm a session stop');
         }
         await transport.stopStrict(input);
      },
      stop: async (input) => {
         try {
            await pick(input.target).stop(input);
         } catch {
            // Nothing to stop through.
         }
      },
   };
}

/**
 * How long a runtime stream may send nothing at all before it is given up on.
 *
 * The runtime writes a keepalive every 15 s while a task runs (and a model
 * step writes more), so four missed keepalives means the stream is gone even
 * if the socket never said so — a port forward that dropped the far end, a
 * container removed under it. Without this the dispatcher held such a run as
 * dispatching, renewing its lease, forever.
 */
export const STREAM_IDLE_MS = 60_000;

/**
 * The chunks of `source`, or a `RuntimeUnavailable` once none arrives for
 * `ms`. `onIdle` aborts the underlying request so its socket is released.
 */
export async function* guardIdle<T>(source: AsyncIterable<T>, ms: number, onIdle: () => void): AsyncGenerator<T> {
   const iterator = source[Symbol.asyncIterator]();
   let finished = false;
   try {
      while (true) {
         let timer: ReturnType<typeof setTimeout> | undefined;
         const idle = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
               onIdle();
               reject(new RuntimeUnavailable(`the runtime sent nothing, not even a keepalive, for ${Math.round(ms / 1000)} s`));
            }, ms);
         });
         try {
            const next = await Promise.race([iterator.next(), idle]);
            if (next.done) {
               finished = true;
               return;
            }
            yield next.value;
         } finally {
            clearTimeout(timer);
         }
      }
   } finally {
      // Not awaited: after an idle timeout the pending read may never settle.
      if (!finished) void iterator.return?.()?.catch?.(() => undefined);
   }
}
