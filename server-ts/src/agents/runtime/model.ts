import { BedrockModel, type BaseModelConfig, type Message, type Model, type ModelStreamEvent, type StreamOptions } from '@strands-agents/sdk';
import { OpenAIModel, type OpenAIModelOptions } from '@strands-agents/sdk/models/openai';
import { kiloFetch, reportedCostMicros, type GatewayUsage } from './kilo-fetch.ts';

/**
 * The one place a model is built.
 *
 * Every caller — a run, the planner, the triage pass, a chat reply, the editor
 * — used to construct its own client, and each one was a place for the
 * credentials to go missing (they did, five times over: BERR-67). One factory
 * means one set of plumbing to get right, and one seam for a test to replace
 * the model with a scripted one.
 */

export interface AwsCredentials {
   accessKeyId: string;
   secretAccessKey: string;
   // Not optional-with-undefined: the AWS clients are built with
   // `exactOptionalPropertyTypes`, and an explicit `undefined` is a different
   // thing to them than an absent key.
   sessionToken?: string;
}

export interface ModelSpec {
   /**
    * The provider's model id: a Bedrock inference profile
    * (`us.anthropic.claude-haiku-4-5-…`) or a Kilo gateway id
    * (`anthropic/claude-haiku-4.5`), depending on the deployment's provider.
    */
   model: string;
   region: string;
   /**
    * Omitted means the AWS default chain — a role, or a local profile. That is
    * wrong wherever `AWS_ACCESS_KEY_ID` belongs to something else: in the
    * Compose stack it is MinIO's, and Bedrock rejects it as an invalid token.
    */
   credentials?: AwsCredentials | null | undefined;
   maxTokens?: number | undefined;
   temperature?: number | undefined;
   /**
    * Whether the reply streams. Streaming is what makes a run readable while
    * it runs, and it needs `bedrock:InvokeModelWithResponseStream`. A single
    * completion has nothing to show while it waits, and asking for the
    * streaming API would only widen the permission it needs.
    */
   stream?: boolean | undefined;
   /**
    * A stable id for the conversation, sent to the Kilo gateway as
    * `X-KiloCode-TaskId`: its auto-routing keeps a model across a session's
    * calls, and it keys prompt caching. Ignored by Bedrock.
    */
   sessionId?: string | undefined;
   /**
    * Whether the conversation is cached, not only the system prompt and tools.
    * Off for a single call nothing follows: writing a cache costs a quarter
    * more than plain input, and no later request would read it. Defaults on.
    */
   cacheConversation?: boolean | undefined;
   /** Told the length of each piece of reasoning the model streams (Kilo only); see `KiloFetchOptions.onReasoning`. */
   onReasoning?: ((chars: number) => void) | undefined;
}

/** What builds a model. Production passes `bedrockModel`; tests pass a script. */
export type ModelFactory = (spec: ModelSpec) => Model<BaseModelConfig>;

/**
 * The ceiling on one model reply.
 *
 * Raised from 8192 after a run failed writing a README: a single `write_file`
 * call carries a whole file as tool input, and the SDK treats a reply cut off
 * at the ceiling as unrecoverable. The default model accepts this value; a
 * deployment on a model that does not sets `BERRY_AGENT_MAX_TOKENS`.
 */
export const DEFAULT_MAX_TOKENS = 32_000;

/**
 * What a family will accept as a reply ceiling. Bedrock refuses a request
 * above it outright, so a value the deployment or the default asks for is
 * clamped here rather than failing every run on that model: Nova Pro stops
 * at 10,000, the smaller Nova models at 5,000. Anything not listed keeps
 * what it was asked for.
 *
 * A list rather than a chain of `if`s so a new family is one row to add. Order
 * matters: the first pattern to match wins, so the pro/premier ceiling has to
 * come before the catch-all Nova one.
 */
const MODEL_CEILINGS: ReadonlyArray<{ pattern: RegExp; ceiling: number }> = [
   // `.` for a Bedrock profile, `/` for the same model's Kilo gateway id.
   { pattern: /amazon[./]nova-(pro|premier)/, ceiling: 10_000 },
   { pattern: /amazon[./]nova-/, ceiling: 5_000 },
];

export function maxTokensFor(model: string, requested: number): number {
   for (const { pattern, ceiling } of MODEL_CEILINGS) {
      if (pattern.test(model)) return Math.min(requested, ceiling);
   }
   // A model that is not listed has no known ceiling, so it keeps what it was
   // asked for — by design, not by omission.
   return requested;
}

/**
 * A Bedrock model for a spec.
 *
 * No API key: Bedrock authenticates with SigV4 through the AWS credential
 * chain, so a deployment on ECS or Lambda holds no model credential at all.
 */
export function bedrockModel(spec: ModelSpec): BedrockModel {
   return new BedrockModel({
      region: spec.region,
      ...(spec.credentials ? { clientConfig: { credentials: spec.credentials } } : {}),
      modelId: spec.model,
      maxTokens: maxTokensFor(spec.model, spec.maxTokens ?? DEFAULT_MAX_TOKENS),
      ...(spec.temperature === undefined ? {} : { temperature: spec.temperature }),
      ...(spec.stream === undefined ? {} : { stream: spec.stream }),
      // Prompt caching, on the part of the request that does not change.
      //
      // Measured on real chat runs: about 6,200 input tokens per model call
      // before the person's message is even counted — the tool schemas and the
      // agent's instructions — and the agent loop re-sends all of it on every
      // iteration, so a reply that called two tools paid it three times. The
      // system prompt and tool config are byte-identical across those calls and
      // across the messages of a session, which is exactly what a cache point
      // is for: prefill becomes a cache read, which is faster and cheaper.
      //
      // `auto` caches only for a model the SDK knows supports it (it matches
      // 'anthropic'/'claude' in the id, which the default inference profile
      // carries) and warns rather than failing on one that does not, so a
      // deployment on Nova or Llama is unaffected.
      cacheConfig: { strategy: 'auto' },
   });
}

/**
 * Usage as a Kilo model reports it: the SDK's counts plus the cost the
 * gateway reported for the call. `costMicros` is null when the gateway said
 * nothing; `AccountingPlugin` reads it where present.
 */
export type ReportedUsage = NonNullable<Extract<ModelStreamEvent, { type: 'modelMetadataEvent' }>['usage']> & {
   costMicros?: number | null;
   /** For a routed model (`kilo-auto/*`), the model the gateway picked for the call. */
   reportedModel?: string;
};

/** One reply's usage as `kiloFetch` saw it. */
interface GatewayReport {
   usage: GatewayUsage;
   model: string | null;
}

/**
 * The SDK's OpenAI model with the two things its OpenAI path cannot carry:
 * the cache-write count and the gateway's reported cost. `kiloFetch` hands
 * each call's usage to `reports` as the reply streams, and this puts it on the
 * call's metadata event, which the SDK yields after the stream ends. One model
 * serves one run and its calls are sequential, so the report belongs to the
 * call whose event takes it.
 */
export class KiloModel extends OpenAIModel {
   readonly #reports: GatewayReport[];

   constructor(reports: GatewayReport[], options: OpenAIModelOptions) {
      super(options);
      this.#reports = reports;
   }

   override async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
      this.#reports.length = 0;
      for await (const event of blocksInOrder(super.stream(messages, options))) {
         if (event.type === 'modelMetadataEvent' && event.usage) {
            const report = this.#reports.shift();
            const usage = event.usage as ReportedUsage;
            if (report) {
               const written = report.usage.cache_creation_input_tokens ?? 0;
               if (written > 0) usage.cacheWriteInputTokens = written;
               // Only a router's pick is worth recording apart: for a fixed
               // model the gateway may spell the same model another way (a
               // dated id), which would split one model's usage in two.
               if (report.model && this.getConfig().modelId?.startsWith('kilo-auto/')) usage.reportedModel = report.model;
            }
            usage.costMicros = report ? reportedCostMicros(report.usage) : null;
         }
         yield event;
      }
   }
}

/**
 * A reply's content blocks, each closed before the next one starts.
 *
 * The SDK's Chat Completions adapter opens a block for every tool call a reply
 * streams but closes them all only at the end, while the SDK assembles one
 * block at a time: each new tool call replaced the one before it, and of a
 * reply that asked for seven tools only the last ran. The agent never heard
 * back from the other six and asked for them again — one task read the same
 * skills thirty-two times — and the transcript showed six calls that never
 * finished. Here a block still open when the next one starts is closed first,
 * and the adapter's closes for blocks already closed are dropped.
 */
export async function* blocksInOrder(events: AsyncIterable<ModelStreamEvent>): AsyncIterable<ModelStreamEvent> {
   let open = false;
   for await (const event of events) {
      if (event.type === 'modelContentBlockStartEvent') {
         if (open) yield { type: 'modelContentBlockStopEvent' } as ModelStreamEvent;
         open = true;
         yield event;
         continue;
      }
      if (event.type === 'modelContentBlockStopEvent') {
         if (!open) continue;
         open = false;
         yield event;
         continue;
      }
      if (event.type === 'modelMessageStopEvent' && open) {
         open = false;
         yield { type: 'modelContentBlockStopEvent' } as ModelStreamEvent;
      }
      yield event;
   }
}

/** Where the runtime reaches the Kilo gateway, and as whom (ADR-0017). */
export interface KiloSettings {
   apiKey: string;
   baseUrl: string;
   /** Sent as `X-KiloCode-OrganizationId`, so the organization's model policy applies. */
   organizationId?: string | undefined;
}

export const DEFAULT_KILO_BASE_URL = 'https://api.kilo.ai/api/gateway';

/**
 * Which provider the runtime calls, read from its environment.
 *
 * `BERRY_MODEL_PROVIDER=kilo` needs `BERRY_KILO_API_KEY`; a Kilo deployment
 * without one is a configuration error, not a quiet fallback to Bedrock, so
 * this throws and the runtime refuses to start.
 */
export function modelProviderFromEnv(
   env: Record<string, string | undefined>
): { provider: 'bedrock' } | { provider: 'kilo'; kilo: KiloSettings } {
   const provider = (env.BERRY_MODEL_PROVIDER ?? 'bedrock').trim().toLowerCase();
   if (provider === 'bedrock' || provider === '') return { provider: 'bedrock' };
   if (provider !== 'kilo') throw new Error(`BERRY_MODEL_PROVIDER must be 'bedrock' or 'kilo', not '${provider}'`);
   const apiKey = (env.BERRY_KILO_API_KEY ?? '').trim();
   if (!apiKey) throw new Error('BERRY_MODEL_PROVIDER=kilo needs BERRY_KILO_API_KEY');
   const organizationId = (env.BERRY_KILO_ORG_ID ?? '').trim();
   return {
      provider: 'kilo',
      kilo: {
         apiKey,
         baseUrl: (env.BERRY_KILO_BASE_URL ?? '').trim() || DEFAULT_KILO_BASE_URL,
         ...(organizationId ? { organizationId } : {}),
      },
   };
}

/**
 * A model reached through the Kilo gateway (ADR-0017).
 *
 * The gateway speaks OpenAI Chat Completions, so this is the SDK's OpenAI
 * model pointed at it. `region` and `credentials` in the spec are Bedrock's and
 * are ignored. The client's own retries are off: `BerryRetryStrategy` owns
 * retrying, and two loops would retry a paid call twice over.
 *
 * Chat Completions always streams in the SDK, so `stream: false` has no
 * effect here; on Bedrock it only narrowed an IAM permission, which the
 * gateway does not have.
 */
export function kiloModel(spec: ModelSpec, kilo: KiloSettings): KiloModel {
   const reports: GatewayReport[] = [];
   const headers: Record<string, string> = {
      ...(kilo.organizationId ? { 'X-KiloCode-OrganizationId': kilo.organizationId } : {}),
      ...(spec.sessionId ? { 'X-KiloCode-TaskId': spec.sessionId } : {}),
   };
   return new KiloModel(reports, {
      api: 'chat',
      modelId: spec.model,
      apiKey: kilo.apiKey,
      clientConfig: {
         baseURL: kilo.baseUrl,
         maxRetries: 0,
         fetch: kiloFetch({
            onUsage: (usage, model) => reports.push({ usage, model }),
            ...(spec.cacheConversation === false ? { cacheConversation: false } : {}),
            ...(spec.onReasoning ? { onReasoning: spec.onReasoning } : {}),
         }),
         ...(Object.keys(headers).length > 0 ? { defaultHeaders: headers } : {}),
      },
      maxTokens: maxTokensFor(spec.model, spec.maxTokens ?? DEFAULT_MAX_TOKENS),
      ...(spec.temperature === undefined ? {} : { temperature: spec.temperature }),
      // Anthropic cache points are added to the request by `kiloFetch`; this
      // gives the gateway a stable per-session key for providers that cache on one.
      cacheConfig: { strategy: 'auto' },
   });
}
