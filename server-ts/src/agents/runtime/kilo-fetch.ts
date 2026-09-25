/**
 * What sits between the OpenAI client and the Kilo gateway (ADR-0017).
 *
 * Three jobs, all about a request Berry has already decided to send:
 *
 * 1. A paid model must be served by the deployment's own provider key (Bedrock
 *    BYOK). Kilo reports that per request as `usage.is_byok`; a paid request
 *    that reports `false` was billed to Kilo credits instead, which the
 *    deployment has ruled out. The call is refused as it arrives, not
 *    discovered on an invoice. A `:free` model has no key to be served by and
 *    is exempt.
 *
 * 2. Anthropic models cache only where the request says so. The SDK's
 *    OpenAI-shaped request has nowhere to say it (it drops cache points with a
 *    warning), so the stable prefix — the system prompt and the tool schemas,
 *    about 6,200 tokens re-sent on every loop iteration — is marked here with
 *    the `cache_control` field the gateway passes through to Anthropic.
 *    Measured through the gateway: a call that read an 11,200-token prefix
 *    from cache cost a twelfth of the call that wrote it.
 *
 * 3. Usage reaches Berry's accounting in Bedrock's terms, with the cost the
 *    gateway reported for the call (the only cost a Kilo deployment records). The gateway puts
 *    usage on the last chunk that still carries a choice, where the SDK does
 *    not look (it reads usage only from a chunk with no choices, as OpenAI
 *    sends it), and counts cached tokens inside `prompt_tokens`, where Bedrock
 *    and Berry's pricing count only uncached input. The usage is split onto a
 *    chunk of its own and `prompt_tokens` made uncached; the cache-write count
 *    and the cost, which the SDK's OpenAI path has no field for, go to `onUsage`.
 */

/** Marks the refusal so `classify` can name it; the gateway's own errors never carry it. */
export const NOT_OWN_KEY_MARKER = 'BERRY_NOT_OWN_KEY';

export function isFreeModel(model: string): boolean {
   return model.endsWith(':free');
}

/**
 * Whether a request is exempt from the own-key rule: a free model has no key
 * to be served by, and Kilo's auto-routing (`kilo-auto/*`, the BerryAuto
 * tier) is an explicit experiment whose own fallback model and classifier are
 * billed to Kilo credits by design. Everything else is refused when Kilo
 * bills it to credits.
 */
export function isOwnKeyExempt(model: string): boolean {
   return isFreeModel(model) || model.startsWith('kilo-auto/');
}

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
}

function notOwnKeyMessage(model: string): string {
   return (
      `${NOT_OWN_KEY_MARKER}: Kilo served ${model} without this deployment's own provider key, ` +
      'so it would have been billed to Kilo credits.'
   );
}

/**
 * The refusal, shaped as the gateway's own error body so the OpenAI client
 * raises it like any other 403: final, not retried, and classified by the
 * marker in its message.
 */
function refusal(model: string): Response {
   return new Response(JSON.stringify({ error: { message: notOwnKeyMessage(model), code: 403 } }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
   });
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
 * send in its place, or throws the refusal.
 */
function rewriteChunk(payload: string, model: string, paid: boolean, options: KiloFetchOptions): string[] {
   let chunk: Chunk;
   try {
      chunk = JSON.parse(payload) as Chunk;
   } catch {
      return [payload];
   }
   const usage = chunk.usage;
   if (!usage) return [payload];
   if (paid && usage.is_byok === false) throw new Error(notOwnKeyMessage(model));
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
function rewriteStream(body: ReadableStream<Uint8Array>, model: string, paid: boolean, options: KiloFetchOptions): ReadableStream<Uint8Array> {
   const decoder = new TextDecoder();
   const encoder = new TextEncoder();
   let pending = '';
   const emit = (event: string, controller: TransformStreamDefaultController<Uint8Array>) => {
      const data = event.startsWith('data:') ? event.slice(5).trim() : null;
      if (data === null || data === '[DONE]' || !data.includes('"usage"')) {
         controller.enqueue(encoder.encode(`${event}\n\n`));
         return;
      }
      for (const payload of rewriteChunk(data, model, paid, options)) {
         controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }
   };
   return body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
         transform(chunk, controller) {
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
            const rest = pending + decoder.decode();
            if (rest.trim().length === 0) return;
            try {
               emit(rest.trimEnd(), controller);
            } catch (error) {
               controller.error(error);
            }
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
 * The request with Anthropic cache points on its stable prefix: the system
 * message and the last tool definition. Anthropic allows four; two cover what
 * does not change within a run.
 */
export function withAnthropicCachePoints(body: ChatBody): ChatBody {
   if (typeof body.model !== 'string' || !body.model.startsWith('anthropic/')) return body;
   const messages = body.messages?.map((message) => {
      if (message.role !== 'system' || typeof message.content !== 'string') return message;
      return { ...message, content: [{ type: 'text', text: message.content, cache_control: EPHEMERAL }] };
   });
   const tools = body.tools?.map((tool, index, all) => (index === all.length - 1 ? { ...tool, cache_control: EPHEMERAL } : tool));
   return {
      ...body,
      ...(messages ? { messages } : {}),
      ...(tools ? { tools } : {}),
   };
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
      const request = parsed ? { ...init, body: JSON.stringify(withAnthropicCachePoints(parsed)) } : init;
      const response = await inner(input, request);
      if (model === null || !response.ok) return response;
      const paid = !isOwnKeyExempt(model);

      const type = response.headers.get('content-type') ?? '';
      if (type.includes('text/event-stream') && response.body) {
         return new Response(rewriteStream(response.body, model, paid, options), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
         });
      }
      if (type.includes('application/json')) {
         const body = (await response.json()) as Chunk;
         if (body.usage) {
            if (paid && body.usage.is_byok === false) return refusal(model);
            options.onUsage?.(body.usage, typeof body.model === 'string' ? body.model : null);
            body.usage = toUncachedUsage(body.usage);
         }
         return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      return response;
   };
}
