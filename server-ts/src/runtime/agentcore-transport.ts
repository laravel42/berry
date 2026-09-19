import {
   BedrockAgentCoreClient,
   InvokeAgentRuntimeCommand,
   StopRuntimeSessionCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import type { TaskEnvelope } from './envelope.ts';
import { parseLifecycleStream, type LifecycleEvent } from './lifecycle.ts';
import {
   RuntimeUnavailable,
   type ExchangeObserver,
   type RuntimeTarget,
   type RuntimeTransport,
   guardIdle,
   STREAM_IDLE_MS,
} from './transport.ts';

/**
 * `InvokeAgentRuntime` with the task envelope; the response body is the
 * runtime's lifecycle SSE stream. Not `InvokeAgentRuntimeCommandCommand` (the
 * shell driver in execution/agentcore-runtime.ts): the loop is in the runtime
 * now, so Berry sends it work rather than shell commands.
 */
export function agentCoreTransport(options: {
   region: string;
   credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | null;
   client?: Pick<BedrockAgentCoreClient, 'send'>;
}): RuntimeTransport {
   const clients = new Map<string, Pick<BedrockAgentCoreClient, 'send'>>();
   const clientFor = (region: string | null) => {
      if (options.client) return options.client;
      const key = region ?? options.region;
      let client = clients.get(key);
      if (!client) {
         client = new BedrockAgentCoreClient({
            region: key,
            ...(options.credentials ? { credentials: options.credentials } : {}),
         });
         clients.set(key, client);
      }
      return client;
   };

   return {
      async *invoke({
         target,
         envelope,
         signal,
         observe,
      }: {
         target: RuntimeTarget;
         envelope: TaskEnvelope;
         signal: AbortSignal;
         observe?: ExchangeObserver | undefined;
      }): AsyncIterable<LifecycleEvent> {
         if (!target.arn) throw new RuntimeUnavailable('this runtime has no ARN');
         let body: AsyncIterable<Uint8Array>;
         // The caller's signal, plus the idle watchdog's: either one ends the request.
         const request = new AbortController();
         const forward = () => request.abort();
         signal.addEventListener('abort', forward, { once: true });
         try {
            const command = new InvokeAgentRuntimeCommand({
               agentRuntimeArn: target.arn,
               qualifier: target.qualifier,
               runtimeSessionId: envelope.runtimeSessionId,
               contentType: 'application/json',
               accept: 'text/event-stream',
               payload: new TextEncoder().encode(JSON.stringify(envelope)),
            });
            if (observe) observeWire(command, observe);
            const response = await clientFor(target.region).send(command, { abortSignal: request.signal as never });
            if (response.response === undefined || response.response === null) throw new Error('the runtime returned no body');
            body = toByteStream(response.response);
         } catch (cause) {
            throw new RuntimeUnavailable(`could not invoke the AgentCore Runtime: ${message(cause)}`, { cause });
         }
         try {
            yield* parseLifecycleStream(guardIdle(body, STREAM_IDLE_MS, forward));
         } finally {
            signal.removeEventListener('abort', forward);
         }
      },

      async stop({ target, runtimeSessionId }) {
         if (!target.arn) return;
         await clientFor(target.region)
            .send(new StopRuntimeSessionCommand({ agentRuntimeArn: target.arn, qualifier: target.qualifier, runtimeSessionId }))
            .catch(() => undefined);
      },
   };
}

/**
 * The request as signed and the response as received, read in the deserialize
 * step: by then the SDK has built the URL and added SigV4, and the response is
 * the raw HTTP one before its body is turned into a stream.
 */
function observeWire(command: InvokeAgentRuntimeCommand, observe: ExchangeObserver): void {
   command.middlewareStack.add(
      (next) => async (args) => {
         const request = args.request as {
            method?: string;
            protocol?: string;
            hostname?: string;
            port?: number;
            path?: string;
            query?: Record<string, string | string[] | null>;
            headers?: Record<string, string>;
         };
         if (request?.hostname) {
            const query = new URLSearchParams();
            for (const [key, value] of Object.entries(request.query ?? {})) {
               for (const item of Array.isArray(value) ? value : [value ?? '']) query.append(key, item);
            }
            const port = request.port ? `:${request.port}` : '';
            const search = query.size > 0 ? `?${query.toString()}` : '';
            observe.request({
               method: request.method ?? 'POST',
               url: `${request.protocol ?? 'https:'}//${request.hostname}${port}${request.path ?? '/'}${search}`,
               headers: lowerKeys(request.headers ?? {}),
            });
         }
         const output = await next(args);
         const response = output.response as { statusCode?: number; headers?: Record<string, string> } | undefined;
         if (response?.statusCode !== undefined) {
            observe.response({ status: response.statusCode, headers: lowerKeys(response.headers ?? {}) });
         }
         return output;
      },
      { step: 'deserialize', name: 'berryExchangeObserver' }
   );
}

function lowerKeys(headers: Record<string, string>): Record<string, string> {
   return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

function message(cause: unknown): string {
   return cause instanceof Error ? cause.message : String(cause);
}

/**
 * `InvokeAgentRuntimeResponse.response` is `StreamingBlobTypes`, whose concrete
 * shape depends on the SDK's runtime: the Node handler yields an async iterable
 * of `Uint8Array`, but a web/undici handler can hand back a `ReadableStream`,
 * and a buffered (non-streamed) reply can arrive as a `Uint8Array`, a `Blob`,
 * or a string. Assuming one shape and `for await`-ing the rest silently
 * iterates zero times, so the executor sees no frames and records
 * `RUNTIME_STREAM_ENDED` even though the body was there — output dropped. This
 * normalises every documented shape into one byte stream the SSE parser reads.
 */
function toByteStream(body: unknown): AsyncIterable<Uint8Array> {
   // Already an async iterable (the common Node SDK stream): pass it through.
   if (body != null && typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function') {
      return body as AsyncIterable<Uint8Array>;
   }
   // A whole buffer or string that arrived in one piece: yield it once.
   if (typeof body === 'string') {
      return once(new TextEncoder().encode(body));
   }
   if (body instanceof Uint8Array) {
      return once(body);
   }
   if (body instanceof ArrayBuffer) {
      return once(new Uint8Array(body));
   }
   // A web ReadableStream (undici/fetch handler): adapt its reader.
   if (isReadableStream(body)) {
      return readableToAsyncIterable(body);
   }
   // A Blob (SDK's `transformToByteArray` input in some runtimes).
   if (isBlob(body)) {
      return (async function* () {
         yield new Uint8Array(await body.arrayBuffer());
      })();
   }
   throw new Error('the runtime response body is not a readable stream');
}

function once(bytes: Uint8Array): AsyncIterable<Uint8Array> {
   return (async function* () {
      yield bytes;
   })();
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
   return typeof ReadableStream !== 'undefined' && value instanceof ReadableStream;
}

function isBlob(value: unknown): value is Blob {
   return typeof Blob !== 'undefined' && value instanceof Blob;
}

async function* readableToAsyncIterable(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
   const reader = stream.getReader();
   try {
      for (;;) {
         const { done, value } = await reader.read();
         if (done) return;
         if (value) yield value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBufferLike);
      }
   } finally {
      reader.releaseLock();
   }
}
