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
      if (schema && result.structuredOutput === undefined) {
         emit({ type: 'task.failed', failure: { code: 'COMPLETION_INVALID', message: textOf(result.lastMessage), retryable: false } });
         return;
      }
      emit({
         type: 'task.completed',
         result: {
            text: textOf(result.lastMessage),
            truncated: false,
            ...(schema ? { structured: result.structuredOutput } : {}),
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
