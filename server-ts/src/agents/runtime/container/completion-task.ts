import {
   AfterModelCallEvent,
   Agent,
   JsonValidationError,
   MessageAddedEvent,
   ModelMetadataEvent,
   ModelStreamUpdateEvent,
   StructuredOutputError,
   type Message,
} from '@strands-agents/sdk';
import { z } from 'zod';
import type { TaskEnvelope } from '../../../runtime/envelope.ts';
import type { TaskModelResponse } from '../../../runtime/lifecycle.ts';
import { BerryRetryStrategy, classify } from '../failure.ts';
import type { ModelFactory } from '../model.ts';
import { textOf, UsageByModel } from '../plugins/accounting.ts';
import type { Emit } from './emitter.ts';
import { toConversation } from './conversation.ts';
import { emitModelUsage } from './usage.ts';
import { withFallback } from '../agent.ts';
import { logRuntimePrompt } from '../prompt-log.ts';

/**
 * One model call for the parts of Berry that are not an agent — the planner,
 * triage, the review gate, a chat reply, the editor.
 *
 * What `llm/completion.ts` did in the server, moved here so the server holds
 * no model client. A fresh agent per call: completions share no session.
 */
export async function runCompletionTask(
   envelope: TaskEnvelope,
   emit: Emit,
   deps: { modelFactory: ModelFactory; region: string },
   signal?: AbortSignal
): Promise<void> {
   emit({ type: 'task.started' });
   const spec = envelope.completion ?? { system: '', jsonSchema: null };
   const schema = spec.jsonSchema ? z.fromJSONSchema(spec.jsonSchema) : undefined;
   const agent = new Agent({
      model: withFallback(
         deps.modelFactory,
         {
            model: envelope.agent.model,
            region: deps.region,
            credentials: null,
            stream: false,
            maxTokens: envelope.agent.maxTokens ?? undefined,
            sessionId: envelope.runtimeSessionId,
            // One call, then nothing reads its conversation again.
            cacheConversation: false,
         },
         envelope.agent.fallbackModel
      ),
      systemPrompt: spec.system,
      retryStrategy: new BerryRetryStrategy(),
      printer: false,
      messages: toConversation(envelope.transcript),
      ...(schema ? { structuredOutputSchema: schema } : {}),
   });
   // Every message of this call, in order: the prompt, then what the model
   // said, including a structured answer's toolUse. Collected from hooks rather
   // than read off `agent.messages` afterwards, because a call that fails its
   // schema rolls those back and the answer would be lost.
   // The model's own reply comes from AfterModelCallEvent, which also sees a
   // reply Strands throws away (a turn that ignored the structured-output tool
   // before it was forced); MessageAddedEvent adds the prompt and tool results.
   // A reply that is both answered and added appears once.
   const added: Message[] = [];
   const seen = new Set<unknown>();
   const keep = (message: Message) => {
      const key = message.toJSON().trackingId ?? message;
      if (seen.has(key)) return;
      seen.add(key);
      added.push(message);
   };
   let stopReason = 'unknown';
   // Usage per serving model, with the gateway's reported cost (ADR-0017):
   // neither is in the SDK's aggregated metrics.
   const byModel = new UsageByModel();
   agent.addHook(ModelStreamUpdateEvent, (event) => {
      if (event.event instanceof ModelMetadataEvent && event.event.usage) byModel.add(event.event.usage);
   });
   agent.addHook(MessageAddedEvent, (event) => keep(event.message));
   agent.addHook(AfterModelCallEvent, (event) => {
      if (!event.stopData) return;
      stopReason = event.stopData.stopReason;
      keep(event.stopData.message);
   });
   const reportModel = () => emit({ type: 'task.model', response: modelResponse(added, stopReason) });
   try {
      logRuntimePrompt(emit, 'system', spec.system);
      logRuntimePrompt(emit, 'user', envelope.task.prompt);
      const result = await agent.invoke(envelope.task.prompt, { ...(signal ? { cancelSignal: signal } : {}) });
      reportModel();
      if (signal?.aborted || result.stopReason === 'cancelled') {
         emit({ type: 'task.failed', failure: { code: 'RUN_CANCELLED', message: 'The completion was stopped.', retryable: false } });
         return;
      }
      emitModelUsage(emit, envelope.agent.model, byModel.entries());
      const conflict = schema ? structuredOutputConflict(added) : null;
      if (conflict) {
         emit({
            type: 'task.failed',
            failure: {
               code: 'COMPLETION_INVALID',
               message: `The answer was split across calls that gave \`${conflict}\` two different values, so neither is taken.`,
               retryable: false,
            },
         });
         return;
      }
      const structured = schema ? mergedStructuredOutput(added, schema) ?? result.structuredOutput : undefined;
      if (schema && structured === undefined) {
         emit({ type: 'task.failed', failure: { code: 'COMPLETION_INVALID', message: textOf(result.lastMessage), retryable: false } });
         return;
      }
      emit({
         type: 'task.completed',
         result: {
            text: textOf(result.lastMessage),
            truncated: false,
            ...(schema ? { structured } : {}),
            delivery: null,
         },
      });
   } catch (error) {
      // A call that failed after the model answered (an answer that did not
      // fit the schema) still shows what the model said.
      if (added.some((message) => message.role === 'assistant')) reportModel();
      if (error instanceof StructuredOutputError || error instanceof JsonValidationError) {
         emit({ type: 'task.failed', failure: { code: 'COMPLETION_INVALID', message: error.message, retryable: false } });
         return;
      }
      emit({ type: 'task.failed', failure: classify(error) });
   }
}

/** The tool Strands forces a structured answer through. */
const STRUCTURED_TOOL = 'strands_structured_output';

/**
 * A structured answer the model split across several calls, put back together.
 *
 * Asked for one large object, a model can answer in parallel calls of the
 * structured-output tool, one per top-level field — seen live: the planner
 * sent `goal`, `milestones`, `assumptions`, `issues` and `approvals` as five
 * calls. Strands keeps the first, so the plan arrived as a goal with no tasks,
 * which a loose schema accepts. When the model's last structured turn holds
 * more than one call, their objects are merged and the merge is kept only if
 * it satisfies the schema; one call, or a merge that does not validate, leaves
 * Strands' own answer in place. Calls that give one field two different values
 * are not merged at all: see structuredOutputConflict.
 */
export function mergedStructuredOutput(
   messages: ReadonlyArray<{ role: string; toJSON(): unknown }>,
   schema: { safeParse(value: unknown): { success: boolean; data?: unknown } }
): unknown {
   const inputs = lastStructuredCalls(messages);
   if (inputs.length < 2 || !inputs.every(isPlainObject)) return undefined;
   if (conflictingKey(inputs as Array<Record<string, unknown>>) !== null) return undefined;
   const parsed = schema.safeParse(Object.assign({}, ...(inputs as object[])));
   return parsed.success ? parsed.data : undefined;
}

/**
 * The top-level field that two of the last structured turn's calls set to
 * different values, or null. Neither value is the answer: a later call winning
 * would keep one plan's tasks and drop the other's without a word, and Strands
 * keeping the first is the same guess the other way.
 */
export function structuredOutputConflict(messages: ReadonlyArray<{ role: string; toJSON(): unknown }>): string | null {
   const inputs = lastStructuredCalls(messages);
   if (inputs.length < 2 || !inputs.every(isPlainObject)) return null;
   return conflictingKey(inputs as Array<Record<string, unknown>>);
}

/** The inputs of the structured-output calls in the last assistant turn that made any. */
function lastStructuredCalls(messages: ReadonlyArray<{ role: string; toJSON(): unknown }>): unknown[] {
   for (const message of [...messages].reverse()) {
      if (message.role !== 'assistant') continue;
      const content = (message.toJSON() as { content?: Array<Record<string, unknown>> }).content ?? [];
      const inputs = content
         .map((block) => block.toolUse as { name?: unknown; input?: unknown } | undefined)
         .filter((use) => use?.name === STRUCTURED_TOOL)
         .map((use) => use?.input);
      if (inputs.length > 0) return inputs;
   }
   return [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
   return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function conflictingKey(inputs: ReadonlyArray<Record<string, unknown>>): string | null {
   const first = new Map<string, string>();
   for (const input of inputs) {
      for (const [key, value] of Object.entries(input)) {
         const canonical = canonicalJson(value);
         const earlier = first.get(key);
         if (earlier === undefined) first.set(key, canonical);
         else if (earlier !== canonical) return key;
      }
   }
   return null;
}

/** JSON with object keys sorted, so the same value written in another key order compares equal. */
function canonicalJson(value: unknown): string {
   if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
   if (isPlainObject(value)) {
      return `{${Object.keys(value)
         .sort()
         .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
         .join(',')}}`;
   }
   return JSON.stringify(value) ?? 'null';
}

/** One frame's worth of model output; past this the messages are cut. */
const MAX_MODEL_JSON = 200_000;

function modelResponse(messages: Array<{ toJSON(): unknown }>, stopReason: string): TaskModelResponse {
   const data = messages.map((message) => message.toJSON() as TaskModelResponse['messages'][number]);
   if (JSON.stringify(data).length <= MAX_MODEL_JSON) return { stopReason, messages: data, truncated: false };
   // Keep the newest messages whole, the model's answer being the last of them.
   const kept: TaskModelResponse['messages'] = [];
   let size = 2;
   for (const message of [...data].reverse()) {
      size += JSON.stringify(message).length + 1;
      if (size > MAX_MODEL_JSON) break;
      kept.unshift(message);
   }
   return { stopReason, messages: kept, truncated: true };
}
