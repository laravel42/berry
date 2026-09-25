import { Model, type BaseModelConfig, type Message, type ModelStreamEvent, type StreamOptions } from '@strands-agents/sdk';
import { isContentBlocked } from './failure.ts';

/**
 * A run's model with its fallback (ADR-0017).
 *
 * The envelope names the model a tier chose and the one to fall back to —
 * the agent's own, or Berry's default from the leaderboard. When the chosen
 * model fails before it has produced anything, the call is made again on the
 * fallback, and the run stays on the fallback from then on: switching back
 * and forth would re-send the context to two caches and blur which model did
 * the work.
 *
 * Not every failure is the model's. A content filter would refuse the same
 * request on any model, and a cancelled call is a person's decision, so
 * neither falls back. A reply that already streamed part of its text cannot
 * be taken back, so it does not fall back either; the retry strategy and the
 * run's failure handling own that case.
 *
 * Usage served by the fallback is marked: `reportedModel` names it, so it is
 * billed as itself, and `fellBack` records that the tier's choice failed.
 */
export class FallbackModel extends Model<BaseModelConfig> {
   readonly #primary: Model<BaseModelConfig>;
   readonly #makeFallback: () => Model<BaseModelConfig>;
   readonly #fallbackId: string;
   readonly #onFallback: ((error: unknown) => void) | undefined;
   #fallback: Model<BaseModelConfig> | null = null;
   #switched = false;

   constructor(
      primary: Model<BaseModelConfig>,
      fallback: { id: string; make: () => Model<BaseModelConfig> },
      onFallback?: (error: unknown) => void
   ) {
      super();
      this.#primary = primary;
      this.#makeFallback = fallback.make;
      this.#fallbackId = fallback.id;
      this.#onFallback = onFallback;
   }

   /** Whether the run has moved to the fallback. */
   get fellBack(): boolean {
      return this.#switched;
   }

   #active(): Model<BaseModelConfig> {
      return this.#switched ? this.#fallbackModel() : this.#primary;
   }

   #fallbackModel(): Model<BaseModelConfig> {
      this.#fallback ??= this.#makeFallback();
      return this.#fallback;
   }

   override updateConfig(modelConfig: BaseModelConfig): void {
      this.#active().updateConfig(modelConfig);
   }

   override getConfig(): BaseModelConfig {
      return this.#active().getConfig();
   }

   override async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
      if (this.#switched) {
         yield* this.#fromFallback(messages, options);
         return;
      }
      let produced = false;
      try {
         for await (const event of this.#primary.stream(messages, options)) {
            produced = true;
            yield event;
         }
      } catch (error) {
         if (produced || !shouldFallBack(error, options)) throw error;
         this.#switched = true;
         this.#onFallback?.(error);
         yield* this.#fromFallback(messages, options);
      }
   }

   async *#fromFallback(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
      for await (const event of this.#fallbackModel().stream(messages, options)) {
         if (event.type === 'modelMetadataEvent' && event.usage) {
            const usage = event.usage as { reportedModel?: string; fellBack?: boolean };
            usage.reportedModel ??= this.#fallbackId;
            usage.fellBack = true;
         }
         yield event;
      }
   }
}

/** A failure another model could plausibly get past. */
export function shouldFallBack(error: unknown, options?: StreamOptions): boolean {
   if (options?.cancelSignal?.aborted) return false;
   const name = (error as { name?: unknown })?.name;
   if (name === 'AbortError' || name === 'APIUserAbortError') return false;
   return !isContentBlocked(error);
}
