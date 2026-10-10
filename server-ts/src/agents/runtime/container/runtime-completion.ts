import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskEnvelope } from '../../../runtime/envelope.ts';
import type { RuntimeAdapterRegistry } from '../adapters/registry.ts';
import { RuntimeAdapterError } from '../adapters/types.ts';
import { MAX_SUMMARY_BYTES } from '../result-text.ts';
import { truncateUtf8 } from '../utf8.ts';
import type { Emit } from './emitter.ts';

/**
 * One completion on a connected CLI, instead of the deployment model.
 *
 * The CLI answers in text. When the call asked for a shape, the JSON object
 * in that text is the structured result the waiter validates.
 */
export async function runRuntimeCompletion(
   envelope: TaskEnvelope,
   emit: Emit,
   deps: { workRoot: string; adapters?: RuntimeAdapterRegistry },
   signal: AbortSignal
): Promise<void> {
   emit({ type: 'task.started' });
   const runtime = envelope.runtime;
   if (!runtime || runtime.executionMode !== 'agent_process') {
      emit({
         type: 'task.failed',
         failure: { code: 'RUNTIME_PROTOCOL', message: 'This completion has no agent runtime.', retryable: false },
      });
      return;
   }
   const adapter = deps.adapters?.agentProcess(runtime.id) ?? null;
   if (!adapter) {
      emit({
         type: 'task.failed',
         failure: {
            code: 'RUNTIME_NOT_INSTALLED',
            message: `${runtime.id} is not installed on this workstation.`,
            retryable: false,
         },
      });
      return;
   }
   const root = join(deps.workRoot, envelope.runtimeSessionId);
   await mkdir(root, { recursive: true });
   const spec = envelope.completion;
   const processEnvelope: TaskEnvelope = {
      ...envelope,
      agent: { ...envelope.agent, instructions: spec?.system ?? envelope.agent.instructions },
      task: { ...envelope.task, prompt: completionPrompt(envelope) },
   };
   try {
      const result = await adapter.start({
         envelope: processEnvelope,
         credential: runtime.credential,
         workingDirectory: root,
         stateDirectory: join(root, '.runtime-state', runtime.id),
         tools: [],
         emit,
         signal,
      });
      const structured = spec?.jsonSchema ? structuredAnswer(result.text) : undefined;
      if (spec?.jsonSchema && structured === undefined) {
         emit({
            type: 'task.failed',
            failure: {
               code: 'COMPLETION_INVALID',
               message: 'the model did not answer in the shape it was asked for',
               retryable: false,
            },
         });
         return;
      }
      const text = result.text;
      emit({
         type: 'task.completed',
         result: {
            text: truncateUtf8(text, MAX_SUMMARY_BYTES),
            truncated: Buffer.byteLength(text) > MAX_SUMMARY_BYTES,
            delivery: null,
            ...(structured !== undefined ? { structured } : {}),
         },
      });
   } catch (error) {
      const failure =
         error instanceof RuntimeAdapterError
            ? { code: error.code, message: error.message, retryable: error.retryable }
            : {
                 code: 'RUNTIME_FAULT',
                 message: error instanceof Error ? error.message : 'The runtime failed.',
                 retryable: true,
              };
      emit({ type: 'task.failed', failure });
   }
}

/** The user turn, plus the schema when the caller wants one JSON object back. */
export function completionPrompt(envelope: TaskEnvelope): string {
   const schema = envelope.completion?.jsonSchema;
   if (!schema) return envelope.task.prompt;
   return `${envelope.task.prompt}\n\nReply with one JSON object and no other text. It must match this schema:\n${JSON.stringify(schema)}`;
}

/** The JSON object in a CLI reply, including one wrapped in a fence or a sentence. */
export function structuredAnswer(text: string): unknown | undefined {
   const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
   const source = fenced?.[1] ?? text;
   const start = source.indexOf('{');
   const end = source.lastIndexOf('}');
   if (start < 0 || end <= start) return undefined;
   try {
      const value: unknown = JSON.parse(source.slice(start, end + 1));
      return value !== null && typeof value === 'object' ? value : undefined;
   } catch {
      return undefined;
   }
}
