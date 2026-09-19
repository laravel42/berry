import {
   AfterModelCallEvent,
   Agent,
   JsonValidationError,
   MessageAddedEvent,
   StructuredOutputError,
   type Message,
} from '@strands-agents/sdk';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { TaskEnvelope } from '../../../runtime/envelope.ts';
import type { TaskModelResponse } from '../../../runtime/lifecycle.ts';
import { BerryRetryStrategy, classify } from '../failure.ts';
import type { ModelFactory } from '../model.ts';
import { textOf } from '../plugins/accounting.ts';
import type { Emit } from './emitter.ts';
import { toConversation } from './conversation.ts';

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
      model: deps.modelFactory({
         model: envelope.agent.model,
         region: deps.region,
         credentials: null,
         stream: false,
         maxTokens: envelope.agent.maxTokens ?? undefined,
      }),
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
   agent.addHook(MessageAddedEvent, (event) => keep(event.message));
   agent.addHook(AfterModelCallEvent, (event) => {
      if (!event.stopData) return;
      stopReason = event.stopData.stopReason;
      keep(event.stopData.message);
   });
   const reportModel = () => emit({ type: 'task.model', response: modelResponse(added, stopReason) });
   try {
      const result = await agent.invoke(envelope.task.prompt, { ...(signal ? { cancelSignal: signal } : {}) });
      reportModel();
      if (signal?.aborted || result.stopReason === 'cancelled') {
         emit({ type: 'task.failed', failure: { code: 'RUN_CANCELLED', message: 'The completion was stopped.', retryable: false } });
         return;
      }
      const usage = result.metrics?.accumulatedUsage;
      emit({
         type: 'task.usage',
         usage: {
            eventId: randomUUID(),
            model: envelope.agent.model,
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            cacheReadTokens: usage?.cacheReadInputTokens ?? 0,
            cacheWriteTokens: usage?.cacheWriteInputTokens ?? 0,
         },
      });
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
 * more than one call, their objects are merged (a later call's field wins) and
 * the merge is kept only if it satisfies the schema; one call, or a merge
 * that does not validate, leaves Strands' own answer in place.
 */
export function mergedStructuredOutput(
   messages: ReadonlyArray<{ role: string; toJSON(): unknown }>,
   schema: { safeParse(value: unknown): { success: boolean; data?: unknown } }
): unknown {
   for (const message of [...messages].reverse()) {
      if (message.role !== 'assistant') continue;
      const content = (message.toJSON() as { content?: Array<Record<string, unknown>> }).content ?? [];
      const inputs = content
         .map((block) => block.toolUse as { name?: unknown; input?: unknown } | undefined)
         .filter((use) => use?.name === STRUCTURED_TOOL)
         .map((use) => use?.input);
      if (inputs.length === 0) continue;
      if (inputs.length === 1) return undefined;
      if (!inputs.every((input) => typeof input === 'object' && input !== null && !Array.isArray(input))) {
         return undefined;
      }
      const parsed = schema.safeParse(Object.assign({}, ...(inputs as object[])));
      return parsed.success ? parsed.data : undefined;
   }
   return undefined;
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
