import {
   Agent,
   SlidingWindowConversationManager,
   type Message,
   type MessageData,
   type Plugin,
   type ToolList,
} from '@strands-agents/sdk';
import { toAgentName } from './agent-name.ts';
import { BerryRetryStrategy } from './failure.ts';
import { bedrockModel, type AwsCredentials, type ModelFactory } from './model.ts';

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
   /**
    * The conversation so far: the live messages of a warm session, or the
    * transcript a cold one was restored from. Absent is a fresh conversation.
    */
   messages?: Message[] | MessageData[] | undefined;
}

/** Messages kept in the model's view of the conversation. */
export const WINDOW_SIZE = 60;

export function buildRunAgent(spec: RunAgentSpec, modelFactory: ModelFactory = bedrockModel): Agent {
   return new Agent({
      model: modelFactory({
         model: spec.model,
         region: spec.region,
         credentials: spec.credentials,
         maxTokens: spec.maxTokens,
         temperature: spec.temperature,
      }),
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
      conversationManager: new SlidingWindowConversationManager({
         windowSize: WINDOW_SIZE,
         proactiveCompression: true,
      }),
      traceAttributes: spec.traceAttributes,
      printer: false,
   });
}

export { toAgentName } from './agent-name.ts';
