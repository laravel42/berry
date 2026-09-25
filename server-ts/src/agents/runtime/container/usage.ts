import { randomUUID } from 'node:crypto';
import type { ModelUsage } from '../plugins/accounting.ts';
import type { Emit } from './emitter.ts';

/**
 * One `task.usage` per model that served the task: a routed model
 * (`kilo-auto/*`, ADR-0017) is billed and charted as what it resolved to,
 * not as the router. A model with every counter at zero is skipped — nothing
 * to bill — but a cache-only call still costs and is sent.
 */
export function emitModelUsage(emit: Emit, requested: string, byModel: ModelUsage[]): void {
   for (const entry of byModel) {
      if (entry.inputTokens === 0 && entry.outputTokens === 0 && entry.cacheReadTokens === 0 && entry.cacheWriteTokens === 0) continue;
      emit({
         type: 'task.usage',
         usage: {
            eventId: randomUUID(),
            model: entry.model ?? requested,
            inputTokens: entry.inputTokens,
            outputTokens: entry.outputTokens,
            cacheReadTokens: entry.cacheReadTokens,
            cacheWriteTokens: entry.cacheWriteTokens,
            ...(entry.reportedCostMicros === undefined ? {} : { reportedCostMicros: entry.reportedCostMicros }),
         },
      });
   }
}
