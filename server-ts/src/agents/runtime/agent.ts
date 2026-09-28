import {
   Agent,
   SlidingWindowConversationManager,
   type ConversationManagerReduceOptions,
   type Message,
   type MessageData,
   type Plugin,
   type ToolList,
} from '@strands-agents/sdk';
import { toAgentName } from './agent-name.ts';
import { BerryRetryStrategy } from './failure.ts';
import { FallbackModel } from './fallback-model.ts';
import { bedrockModel, type AwsCredentials, type ModelFactory, type ModelSpec } from './model.ts';

/**
 * The agent for one run, built in one place.
 *
 * Everything Berry adds to the SDK's loop arrives as a plugin: the ledger,
 * permissions, accounting, the tool-failure policy. The executor constructs
 * those with the run in scope and hands them here; this file is the only one
 * that knows what an `Agent` is made of.
 */

export interface RunAgentSpec {
   agentName: string;
   model: string;
   region: string;
   credentials: AwsCredentials | null;
   systemPrompt: string;
   /** Berry's tools, the shell, and the agent's MCP clients. */
   tools: ToolList;
   plugins: Plugin[];
   maxTokens?: number | undefined;
   temperature?: number | undefined;
   traceAttributes: Record<string, string>;
   /** Stable per agent and issue; see `ModelSpec.sessionId`. */
   sessionId?: string | undefined;
   /** The model to switch to when `model` fails before producing anything (ADR-0017). */
   fallbackModel?: string | null | undefined;
   /**
    * The conversation so far: the live messages of a warm session, or the
    * transcript a cold one was restored from. Absent is a fresh conversation.
    */
   messages?: Message[] | MessageData[] | undefined;
   /** See `ModelSpec.onReasoning`. */
   onReasoning?: ((text: string) => void) | undefined;
}

/** Messages kept in the model's view of the conversation. */
export const WINDOW_SIZE = 60;

/**
 * The sliding window, cutting deep when the context nears its limit.
 *
 * The SDK compresses proactively once a call's input passes 70% of the
 * model's context, and then drops only the two oldest messages. The next call
 * is over the threshold again, so it drops two more, and so on: every step
 * changes the start of the conversation, which is the prefix the prompt cache
 * is keyed on. Measured on a Sonnet 5 run: from 140k tokens on, each step read
 * only the system prompt from cache and wrote the other ~150k again at a
 * quarter above the input price, about $0.40 a step.
 *
 * So a proactive cut keeps only the newest half of the conversation. The cache
 * is written once for what is left, and the steps after it read it until the
 * conversation grows back to the threshold. A reduction the model forced (an
 * overflow error) is the SDK's own, unchanged.
 */
export class DeepCutConversationManager extends SlidingWindowConversationManager {
   override reduce(options: ConversationManagerReduceOptions): boolean {
      if (options.error) return super.reduce(options);
      const messages = options.agent.messages;
      const keep = Math.ceil(messages.length / 2);
      let reduced = false;
      while (messages.length > keep) {
         const before = messages.length;
         if (!super.reduce(options) || messages.length >= before) break;
         reduced = true;
      }
      return reduced;
   }
}

export function buildRunAgent(spec: RunAgentSpec, modelFactory: ModelFactory = bedrockModel): Agent {
   const modelSpec: ModelSpec = {
      model: spec.model,
      region: spec.region,
      credentials: spec.credentials,
      maxTokens: spec.maxTokens,
      temperature: spec.temperature,
      sessionId: spec.sessionId,
      onReasoning: spec.onReasoning,
   };
   return new Agent({
      model: withFallback(modelFactory, modelSpec, spec.fallbackModel),
      name: toAgentName(spec.agentName),
      systemPrompt: spec.systemPrompt,
      tools: spec.tools,
      plugins: spec.plugins,
      ...(spec.messages ? { messages: spec.messages } : {}),
      // Replacing the SDK's default rather than joining it, so a throttled
      // call is retried on Berry's idea of transient and nothing else.
      retryStrategy: new BerryRetryStrategy(),
      // A long run reads many files and runs many commands; without a ceiling
      // the conversation grows until the model refuses it. The window keeps
      // the recent turns and the run ledger keeps everything that fell out.
      //
      // The window is pair-aware, so trimming to the recent N never severs a
      // toolUse from its toolResult (which Bedrock rejects on the next invoke).
      // SlidingWindowConversationManager trims via findValidTrimPoint, which
      // walks the cut forward off any leading orphan toolResult and off a
      // trailing toolUse whose toolResult doesn't follow; when no plain user
      // cut exists it falls back to a complete tool pair. Large tool results
      // are truncated in place (shouldTruncateResults, default on) before any
      // trim. So the window size is safe as-is — no wrapper needed.
      conversationManager: new DeepCutConversationManager({
         windowSize: WINDOW_SIZE,
         proactiveCompression: true,
      }),
      traceAttributes: spec.traceAttributes,
      printer: false,
   });
}

/** The spec's model, wrapped with its fallback when there is one that differs from it. */
export function withFallback(modelFactory: ModelFactory, spec: ModelSpec, fallbackModel: string | null | undefined) {
   const primary = modelFactory(spec);
   if (!fallbackModel || fallbackModel === spec.model) return primary;
   return new FallbackModel(primary, { id: fallbackModel, make: () => modelFactory({ ...spec, model: fallbackModel }) });
}

export { toAgentName } from './agent-name.ts';
