import { z } from 'zod';

/**
 * One finished run, as the exporter uploads it and the analyzer reads it.
 *
 * The exporter is the only thing that reads Berry's database; the function
 * sees this file and nothing else, so everything the analysis and the stored
 * finding need (the task, the agent's tier, provider and model) travels here.
 */
export const BUNDLE_VERSION = 1;

const nullableText = z.string().nullable();

export const RunEventSchema = z.object({
   sequence: z.number().int().nonnegative(),
   type: z.string().min(1),
   at: z.string(),
   payload: z.unknown(),
});

export const RunBundleSchema = z.object({
   version: z.literal(BUNDLE_VERSION),
   exportedAt: z.string(),
   run: z.object({
      id: z.string().min(1),
      kind: z.string(),
      source: nullableText,
      status: z.enum(['succeeded', 'failed', 'cancelled']),
      createdAt: z.string(),
      startedAt: nullableText,
      completedAt: z.string(),
      failure: z.object({ code: z.string(), message: z.string(), retryable: z.boolean().nullable() }).nullable(),
      summary: nullableText,
      usage: z.object({
         inputTokens: z.number(),
         outputTokens: z.number(),
         totalTokens: z.number(),
         costMicros: z.number().nullable(),
         currency: nullableText,
      }),
   }),
   task: z.object({
      id: nullableText,
      identifier: nullableText,
      title: nullableText,
      description: nullableText,
      workspace: nullableText,
      board: nullableText,
   }),
   agent: z.object({
      id: z.string(),
      name: nullableText,
      role: nullableText,
      /** The Berry tier the agent runs on (`berry_max` …), or null for the deployment default. */
      tier: nullableText,
      /** The subscription runtime (`kiro`, `claude` …) when the run used one, else the model provider. */
      provider: nullableText,
      model: nullableText,
      /** The Berry tools the agent's contract allows, before the autonomy ceiling. */
      allowedTools: z.array(z.string()),
   }),
   events: z.array(RunEventSchema),
});

export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunBundle = z.infer<typeof RunBundleSchema>;

/** Where a run's bundle lives in the bucket. The function is triggered on this prefix. */
export const TRANSCRIPT_PREFIX = 'runs/';

export function transcriptKey(runId: string, completedAt: string): string {
   const day = completedAt.slice(0, 10).replaceAll('-', '/');
   return `${TRANSCRIPT_PREFIX}${day}/${runId}.json`;
}
