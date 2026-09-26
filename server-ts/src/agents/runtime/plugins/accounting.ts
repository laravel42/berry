import {
   AfterModelCallEvent,
   BeforeToolCallEvent,
   MessageAddedEvent,
   ModelMetadataEvent,
   ModelStreamUpdateEvent,
   type LocalAgent,
   type Message,
   type Plugin,
} from '@strands-agents/sdk';
import type { Usage } from '../../../runs/ledger.ts';
import { ResultText } from '../result-text.ts';

/**
 * What the run cost and what it concluded.
 *
 * Usage comes from the stream's metadata event, once per model call; the SDK
 * aggregates the same numbers into `AgentResult.metrics`, and a test keeps
 * the two equal. The result text comes from each assistant message as the
 * SDK adds it to the conversation — one `endTurn` per message, which is the
 * boundary `ResultText` needs to tell a report from a sign-off.
 */

export interface AccountingSnapshot {
   usage: Usage;
   /** Prompt-cache tokens. Kept beside `usage` because the ledger's Usage has no place for them. */
   cacheReadTokens: number;
   cacheWriteTokens: number;
   /**
    * The cost the model gateway reported, summed over the run's calls (ADR-0017).
    * Undefined when no call reported one — a Bedrock deployment, priced by
    * Berry instead. Null when some call reported nothing: a partial sum would
    * understate the run, so the whole run goes unpriced.
    */
   reportedCostMicros: number | null | undefined;
   /**
    * The same usage split by the model that served it. A gateway that routes
    * (`kilo-auto/*`, ADR-0017) reports the model it picked per call, and a run
    * may cross several; everything else is one entry with `model: null`,
    * meaning the model the run asked for.
    */
   byModel: ModelUsage[];
   toolCalls: number;
   modelCalls: number;
   result: ResultText;
}

export interface ModelUsage {
   /** The model the gateway reported serving the calls, or null for the one asked for. */
   model: string | null;
   inputTokens: number;
   outputTokens: number;
   cacheReadTokens: number;
   cacheWriteTokens: number;
   reportedCostMicros: number | null | undefined;
   /** The tier's choice had failed and the run's fallback model served these calls. */
   fellBack: boolean;
}

type MetadataUsage = {
   inputTokens: number;
   outputTokens: number;
   cacheReadInputTokens?: number | undefined;
   cacheWriteInputTokens?: number | undefined;
};

/** Model-call usage tallied per serving model, in the order models first appeared. */
export class UsageByModel {
   readonly #entries = new Map<string | null, ModelUsage>();

   add(usage: MetadataUsage): void {
      const reported = (usage as { reportedModel?: unknown }).reportedModel;
      const model = typeof reported === 'string' && reported.length > 0 ? reported : null;
      let entry = this.#entries.get(model);
      if (!entry) {
         entry = { model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reportedCostMicros: undefined, fellBack: false };
         this.#entries.set(model, entry);
      }
      entry.inputTokens += usage.inputTokens;
      entry.outputTokens += usage.outputTokens;
      entry.cacheReadTokens += usage.cacheReadInputTokens ?? 0;
      entry.cacheWriteTokens += usage.cacheWriteInputTokens ?? 0;
      entry.reportedCostMicros = addReportedCost(entry.reportedCostMicros, usage);
      if ((usage as { fellBack?: unknown }).fellBack === true) entry.fellBack = true;
   }

   entries(): ModelUsage[] {
      return [...this.#entries.values()].map((entry) => ({ ...entry }));
   }
}

export class AccountingPlugin implements Plugin {
   readonly name = 'berry:accounting';
   readonly #usage: Usage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costMicros: null,
      currency: null,
   };
   readonly #result = new ResultText();
   #toolCalls = 0;
   #modelCalls = 0;
   #cacheReadTokens = 0;
   #cacheWriteTokens = 0;
   #reportedCostMicros: number | null | undefined = undefined;
   readonly #byModel = new UsageByModel();
   readonly #onCall: ((usage: ModelUsage) => void) | undefined;

   /**
    * `onCall` hears each model call's usage as it happens, so a run's tokens
    * and cost are recorded while it works — and kept if it is cut off —
    * rather than only when it ends.
    */
   constructor(options: { onCall?: (usage: ModelUsage) => void } = {}) {
      this.#onCall = options.onCall;
   }

   initAgent(agent: LocalAgent): void {
      agent.addHook(ModelStreamUpdateEvent, (event) => {
         const inner = event.event;
         if (inner instanceof ModelMetadataEvent && inner.usage) {
            this.#usage.inputTokens += inner.usage.inputTokens;
            this.#usage.outputTokens += inner.usage.outputTokens;
            // Completion total only: cache tokens are excluded on purpose and
            // tracked apart in #cacheReadTokens/#cacheWriteTokens. Downstream
            // reads Usage.totalTokens as input+output — do not fold cache in.
            this.#usage.totalTokens = this.#usage.inputTokens + this.#usage.outputTokens;
            this.#cacheReadTokens += inner.usage.cacheReadInputTokens ?? 0;
            this.#cacheWriteTokens += inner.usage.cacheWriteInputTokens ?? 0;
            this.#reportedCostMicros = addReportedCost(this.#reportedCostMicros, inner.usage);
            this.#byModel.add(inner.usage);
            if (this.#onCall) {
               const call = new UsageByModel();
               call.add(inner.usage);
               const [entry] = call.entries();
               if (entry) this.#onCall(entry);
            }
         }
      });
      agent.addHook(AfterModelCallEvent, () => {
         this.#modelCalls += 1;
      });
      agent.addHook(BeforeToolCallEvent, () => {
         this.#toolCalls += 1;
      });
      agent.addHook(MessageAddedEvent, (event) => {
         if (event.message.role !== 'assistant') return;
         this.#result.append(textOf(event.message));
         this.#result.endTurn();
      });
   }

   snapshot(): AccountingSnapshot {
      return {
         usage: { ...this.#usage },
         cacheReadTokens: this.#cacheReadTokens,
         cacheWriteTokens: this.#cacheWriteTokens,
         reportedCostMicros: this.#reportedCostMicros,
         byModel: this.#byModel.entries(),
         toolCalls: this.#toolCalls,
         modelCalls: this.#modelCalls,
         result: this.#result,
      };
   }
}

/**
 * A running total of gateway-reported cost, with one more call's usage added.
 * A call whose usage carries no `costMicros` key (Bedrock) leaves the total
 * as it was; one that carries `null` makes the whole total unknown.
 */
export function addReportedCost(total: number | null | undefined, usage: object): number | null | undefined {
   if (!('costMicros' in usage)) return total;
   const cost = (usage as { costMicros?: unknown }).costMicros;
   if (total === null || typeof cost !== 'number') return null;
   return (total ?? 0) + cost;
}

/** The text blocks of a message, joined. Tool-use blocks say nothing. */
export function textOf(message: Message): string {
   return message.content
      .map((block) => (block.type === 'textBlock' ? block.text : ''))
      .join('');
}
