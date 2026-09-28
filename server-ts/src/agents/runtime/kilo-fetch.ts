/**
 * What sits between the OpenAI client and the Kilo gateway (ADR-0017).
 *
 * Two jobs, both about a request Berry has already decided to send. (A
 * third, refusing a paid call Kilo billed to credits rather than to the
 * deployment's own key, was dropped on 2026-09-26: the tiers now take models
 * from every provider Kilo serves, and the cost is what Kilo reports either
 * way.)
 *
 * 1. Anthropic models cache only where the request says so. The SDK's
 *    OpenAI-shaped request has nowhere to say it (it drops cache points with a
 *    warning), so the stable prefix — the system prompt and the tool schemas,
 *    about 6,200 tokens re-sent on every loop iteration — is marked here with
 *    the `cache_control` field the gateway passes through to Anthropic.
 *    Measured through the gateway: a call that read an 11,200-token prefix
 *    from cache cost a twelfth of the call that wrote it.
 *
 * 2. Usage reaches Berry's accounting in Bedrock's terms, with the cost the
 *    gateway reported for the call (the only cost a Kilo deployment records). The gateway puts
 *    usage on the last chunk that still carries a choice, where the SDK does
 *    not look (it reads usage only from a chunk with no choices, as OpenAI
 *    sends it), and counts cached tokens inside `prompt_tokens`, where Bedrock
 *    and Berry's pricing count only uncached input. The usage is split onto a
 *    chunk of its own and `prompt_tokens` made uncached; the cache-write count
 *    and the cost, which the SDK's OpenAI path has no field for, go to `onUsage`.
 */

export function isFreeModel(model: string): boolean {
   return model.endsWith(':free');
}

/**
 * How long the gateway may say nothing before the call is abandoned: before
 * the response headers, and again between any two chunks of a stream.
 *
 * Not a cap on the call. A plan is minutes of work and a model may think for
 * a while before its first token, so only silence is bounded. The gateway
 * accepted a plan repair and then never answered it: Berry gave up on the run
 * after five minutes, but this request stayed open, and with it the session's
 * container, which the local router will not reap while a request is in
 * flight. Aborting here is what lets the socket go, and the container with it.
 */
export const STALL_MS = 120_000;

/** The gateway took the request and then said nothing. Not an answer, so worth trying again. */
export class GatewaySilent extends Error {
   override readonly name = 'GatewaySilent';
   readonly retryable = true;
   constructor(ms: number) {
      super(`the model gateway sent nothing for ${Math.round(ms / 1000)}s`);
   }
}

/**
 * A deadline only silence can reach.
 *
 * `touch` restarts the clock, so a reply that is still arriving never trips
 * it however long it runs. The signal aborts this request rather than merely
 * stopping the wait: a caller that gave up somewhere else does not close this
 * socket, and an unclosed socket is what kept a container alive.
 */
function stallWatch(ms: number, outer: AbortSignal | null | undefined) {
   const controller = new AbortController();
   let expired = false;
   let timer: ReturnType<typeof setTimeout> | null = null;
   const done = () => {
      if (timer) clearTimeout(timer);
      timer = null;
   };
   const touch = () => {
      done();
      timer = setTimeout(() => {
         expired = true;
         controller.abort();
      }, ms);
      timer.unref?.();
   };
   touch();
   return {
      signal: outer ? AbortSignal.any([outer, controller.signal]) : controller.signal,
      touch,
      done,
      /** Whether this watch is what aborted, rather than the caller. */
      get expired(): boolean {
         return expired;
      },
   };
}

type StallWatch = ReturnType<typeof stallWatch>;

/** The usage fields the gateway reports that Berry reads. */
export interface GatewayUsage {
   prompt_tokens?: number;
   completion_tokens?: number;
   total_tokens?: number;
   prompt_tokens_details?: { cached_tokens?: number };
   cache_creation_input_tokens?: number;
   is_byok?: boolean;
   /** USD billed to Kilo credits: zero when the deployment's own key served the call. */
   cost?: number;
   /** USD the provider charged the deployment's own key. */
   cost_details?: { upstream_inference_cost?: number };
}

/**
 * What the call cost, in USD micros, as the gateway reported it — the only
 * cost Berry records for a Kilo deployment. A call served by the deployment's
 * own key is billed by its provider (`upstream_inference_cost`); anything else
 * by Kilo (`cost`, zero for a free model). Null when the gateway said nothing,
 * which a reader shows as "no price", never as free.
 */
export function reportedCostMicros(usage: GatewayUsage): number | null {
   const usd = usage.is_byok === true ? usage.cost_details?.upstream_inference_cost : usage.cost;
   return typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 ? Math.round(usd * 1_000_000) : null;
}

export interface KiloFetchOptions {
   /**
    * Called with each reply's usage as the gateway reported it, before it is
    * rewritten, and the model the reply says served it — for `kilo-auto/*`,
    * the model the router picked.
    */
   onUsage?: (usage: GatewayUsage, model: string | null) => void;
   /** False leaves the messages unmarked: see `withAnthropicCachePoints`. */
   cacheConversation?: boolean;
   /**
    * Called with each piece of reasoning the model streams. The SDK's chat
    * adapter reads only text and tool calls, so a model thinking for minutes
    * before a short reply otherwise looks like a run that stopped — and what
    * it thought would be lost.
    */
   onReasoning?: (text: string) => void;
   /** Silence after which the call is abandoned. See `STALL_MS`. */
   stallMs?: number;
}

/**
 * The reasoning one streamed chunk carries: `reasoning`, `reasoning_content`
 * or `reasoning_details[].text`. A gateway that sends the same passage both as
 * a string and as details is read once, from the string.
 */
export function reasoningText(payload: string): string {
   if (!payload.includes('"reasoning')) return '';
   let chunk: { choices?: Array<{ delta?: Record<string, unknown> }> };
   try {
      chunk = JSON.parse(payload) as typeof chunk;
   } catch {
      return '';
   }
   let text = '';
   for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {};
      const plain = [delta.reasoning, delta.reasoning_content].filter((value): value is string => typeof value === 'string');
      if (plain.length > 0) {
         text += plain.join('');
         continue;
      }
      const details = delta.reasoning_details;
      if (Array.isArray(details)) {
         for (const detail of details) {
            const piece = (detail as { text?: unknown; summary?: unknown }).text ?? (detail as { summary?: unknown }).summary;
            if (typeof piece === 'string') text += piece;
         }
      }
   }
   return text;
}

/** `prompt_tokens` without the cached part, which Berry prices apart. */
export function toUncachedUsage(usage: GatewayUsage): GatewayUsage {
   const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
   const written = usage.cache_creation_input_tokens ?? 0;
   return { ...usage, prompt_tokens: Math.max(0, (usage.prompt_tokens ?? 0) - cached - written) };
}

type Chunk = { choices?: unknown[]; usage?: GatewayUsage | null } & Record<string, unknown>;

/**
 * One SSE event's `data:` payload, rewritten: the usage checked, reported,
 * made uncached, and moved onto a chunk of its own. Returns the payloads to
 * send in its place.
 */
function rewriteChunk(payload: string, options: KiloFetchOptions): string[] {
   let chunk: Chunk;
   try {
      chunk = JSON.parse(payload) as Chunk;
   } catch {
      return [payload];
   }
   const usage = chunk.usage;
   if (!usage) return [payload];
   options.onUsage?.(usage, typeof chunk.model === 'string' ? chunk.model : null);
   const { usage: _moved, ...rest } = chunk;
   const usageOnly = { ...rest, choices: [], usage: toUncachedUsage(usage) };
   if (!chunk.choices || chunk.choices.length === 0) return [JSON.stringify(usageOnly)];
   return [JSON.stringify(rest), JSON.stringify(usageOnly)];
}

/**
 * The reply stream, event by event. SSE events end at a blank line, so text
 * is held until one completes; anything that is not a `data:` event with a
 * usage passes through as it came.
 */
function rewriteStream(
   body: ReadableStream<Uint8Array>,
   options: KiloFetchOptions,
   watch: StallWatch
): ReadableStream<Uint8Array> {
   const decoder = new TextDecoder();
   const encoder = new TextEncoder();
   let pending = '';
   const emit = (event: string, controller: TransformStreamDefaultController<Uint8Array>) => {
      const data = event.startsWith('data:') ? event.slice(5).trim() : null;
      if (data !== null && options.onReasoning) {
         const text = reasoningText(data);
         if (text !== '') options.onReasoning(text);
      }
      if (data === null || data === '[DONE]' || !data.includes('"usage"')) {
         controller.enqueue(encoder.encode(`${event}\n\n`));
         return;
      }
      for (const payload of rewriteChunk(data, options)) {
         controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }
   };
   return body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
         transform(chunk, controller) {
            // Anything at all counts as the gateway still answering, including
            // the keep-alive comments it sends between two slow chunks.
            watch.touch();
            pending += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
            let end = pending.indexOf('\n\n');
            while (end !== -1) {
               const event = pending.slice(0, end);
               pending = pending.slice(end + 2);
               if (event.length > 0) {
                  try {
                     emit(event, controller);
                  } catch (error) {
                     controller.error(error);
                     return;
                  }
               }
               end = pending.indexOf('\n\n');
            }
         },
         flush(controller) {
            watch.done();
            const rest = pending + decoder.decode();
            if (rest.trim().length === 0) return;
            try {
               emit(rest.trimEnd(), controller);
            } catch (error) {
               controller.error(error);
            }
         },
         cancel() {
            watch.done();
         },
      })
   );
}

type ChatBody = {
   model?: unknown;
   messages?: Array<{ role?: unknown; content?: unknown }>;
   tools?: Array<Record<string, unknown>>;
};

const EPHEMERAL = { type: 'ephemeral' } as const;

/**
 * The request with Anthropic cache points, all four Anthropic allows.
 *
 * Two on what does not change within a run: the system message and the last
 * tool definition. Two on the conversation, which is most of what an agent's
 * request carries — every tool result, file and command output so far — and
 * which was sent uncached on every step: Opus 5.5 read 13% of its input from
 * cache in a day and paid full price for 5.6M tokens. Anthropic caches up to a
 * marker, so the newest message is marked, and so is the message that ended
 * the previous request (the one before the last assistant turn), where that
 * request's cache was written: found there even when a burst of tool results
 * put the newest marker far past it.
 *
 * A single call nothing follows (a completion: triage, the review gate, the
 * planner) marks no message. Writing a cache costs a quarter more than plain
 * input and is only repaid by a later request that reads it; its system
 * prompt and tools still are, since the next call of the same kind repeats them.
 */
export function withAnthropicCachePoints(body: ChatBody, options: { conversation?: boolean } = {}): ChatBody {
   if (typeof body.model !== 'string' || !body.model.startsWith('anthropic/')) return body;
   const all = body.messages ?? [];
   const lastAssistant = all.map((message) => message.role).lastIndexOf('assistant');
   const marked = new Set(
      options.conversation === false ? [] : [all.length - 1, lastAssistant - 1].filter((index) => index > 0 && all[index]?.role !== 'system')
   );
   const messages = body.messages?.map((message, index) => {
      if (message.role === 'system' && typeof message.content === 'string') {
         return { ...message, content: [{ type: 'text', text: message.content, cache_control: EPHEMERAL }] };
      }
      return marked.has(index) ? withCachePoint(message) : message;
   });
   const tools = body.tools?.map((tool, index, list) => (index === list.length - 1 ? { ...tool, cache_control: EPHEMERAL } : tool));
   return {
      ...body,
      ...(messages ? { messages } : {}),
      ...(tools ? { tools } : {}),
   };
}

/** A message with a cache point on its last content part; one with no text to hang it on is left as it is. */
function withCachePoint(message: { role?: unknown; content?: unknown }): { role?: unknown; content?: unknown } {
   if (typeof message.content === 'string') {
      return message.content === '' ? message : { ...message, content: [{ type: 'text', text: message.content, cache_control: EPHEMERAL }] };
   }
   if (!Array.isArray(message.content) || message.content.length === 0) return message;
   const parts = [...(message.content as Array<Record<string, unknown>>)];
   parts[parts.length - 1] = { ...parts[parts.length - 1], cache_control: EPHEMERAL };
   return { ...message, content: parts };
}

function parseBody(init: RequestInit | undefined): ChatBody | null {
   if (typeof init?.body !== 'string') return null;
   try {
      return JSON.parse(init.body) as ChatBody;
   } catch {
      return null;
   }
}

/** A `fetch` for the OpenAI client that applies all three rules to every chat request. */
export function kiloFetch(options: KiloFetchOptions = {}, inner: typeof fetch = fetch): typeof fetch {
   return async (input, init) => {
      const parsed = parseBody(init);
      const model = parsed && typeof parsed.model === 'string' ? parsed.model : null;
      const request = parsed ? { ...init, body: JSON.stringify(withAnthropicCachePoints(parsed, { conversation: options.cacheConversation !== false })) } : init;
      const watch = stallWatch(options.stallMs ?? STALL_MS, init?.signal);
      let response: Response;
      try {
         response = await inner(input, { ...request, signal: watch.signal });
      } catch (error) {
         watch.done();
         // A gateway that never replied reads as a broken connection here, and
         // "fetch failed" would send a reader looking for a network fault.
         throw watch.expired ? new GatewaySilent(options.stallMs ?? STALL_MS) : error;
      }
      if (model === null || !response.ok) {
         watch.done();
         return response;
      }

      const type = response.headers.get('content-type') ?? '';
      // Handed on still armed: a stream that stops halfway is the same silence
      // as one that never started, and the headers arriving prove nothing.
      if (type.includes('text/event-stream') && response.body) {
         return new Response(rewriteStream(response.body, options, watch), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
         });
      }
      try {
         if (type.includes('application/json')) {
            const body = (await response.json()) as Chunk;
            if (body.usage) {
               options.onUsage?.(body.usage, typeof body.model === 'string' ? body.model : null);
               body.usage = toUncachedUsage(body.usage);
            }
            return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers: response.headers });
         }
         return response;
      } finally {
         watch.done();
      }
   };
}
