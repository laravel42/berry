import type { Tool } from '@strands-agents/sdk';
import type { TaskEnvelope } from '../../../runtime/envelope.ts';
import type { Emit } from '../container/emitter.ts';

export type RuntimeAdapterKind = 'direct_inference' | 'agent_process';
export type RuntimeAuthStatus = 'connected' | 'expired' | 'missing' | 'error';
export type RuntimePrincipalIsolation = 'agentcore_session' | 'session_container' | 'workstation' | 'shared_process';

export interface RuntimeAdapterCapabilities {
   modelDiscovery: boolean;
   streaming: boolean;
   tools: boolean;
   sessions: boolean;
   cancellation: boolean;
   usage: boolean;
}

export interface RuntimeAdapterIdentity {
   id: string;
   name: string;
   kind: RuntimeAdapterKind;
   provider: string;
   billing: 'subscription' | 'api_billing' | 'provider_dependent' | 'unknown';
   capabilities: RuntimeAdapterCapabilities;
}

export interface RuntimeAvailability {
   available: boolean;
   version: string | null;
   reason: string | null;
   protocolVersion: 1;
   principalIsolation: RuntimePrincipalIsolation;
}

export interface RuntimeConnectionStatus {
   status: RuntimeAuthStatus;
   accountId: string | null;
   accountName: string | null;
   detail: string | null;
}

export interface RuntimeModel {
   id: string;
   name: string;
   reasoning: boolean | null;
   tools: boolean | null;
   policy: string | null;
}

export interface RuntimeUsage {
   inputTokens: number;
   outputTokens: number;
   cacheReadTokens: number;
   cacheWriteTokens: number;
   model: string;
   eventId?: string;
   quotaUsedPercent?: number | null;
   quotaResetsAt?: string | null;
}

export type RuntimeAdapterEvent =
   | { type: 'text'; text: string }
   | { type: 'thinking'; text: string }
   | { type: 'tool.started'; id: string; name: string }
   | { type: 'tool.output'; id: string; stream: 'stdout' | 'stderr'; text: string }
   | { type: 'tool.completed'; id: string; succeeded: boolean; durationMs: number }
   | { type: 'usage'; usage: RuntimeUsage }
   | { type: 'status'; status: 'starting' | 'running' | 'waiting' | 'completed' | 'cancelled' };

export type RuntimeAdapterErrorCode =
   | 'AUTH_REQUIRED'
   | 'AUTH_EXPIRED'
   | 'QUOTA_EXHAUSTED'
   | 'MODEL_UNAVAILABLE'
   | 'NETWORK_ERROR'
   | 'RUNTIME_NOT_INSTALLED'
   | 'RUNTIME_PROTOCOL'
   | 'RUNTIME_ISOLATION_REQUIRED'
   | 'RUNTIME_LIMIT_REACHED'
   | 'RUNTIME_TIMEOUT'
   | 'RUNTIME_CANCELLED'
   | 'RUNTIME_ERROR';

export class RuntimeAdapterError extends Error {
   override readonly name = 'RuntimeAdapterError';
   readonly code: RuntimeAdapterErrorCode;
   readonly retryable: boolean;

   constructor(code: RuntimeAdapterErrorCode, message: string, retryable: boolean, options?: ErrorOptions) {
      super(message, options);
      this.code = code;
      this.retryable = retryable;
   }
}

export interface RuntimeAdapterBase {
   readonly identity: RuntimeAdapterIdentity;
   checkAvailability(): Promise<RuntimeAvailability>;
   connectionStatus(credential: RuntimeCredential | null): Promise<RuntimeConnectionStatus>;
   disconnect(): Promise<void>;
   discoverModels(credential: RuntimeCredential): Promise<RuntimeModel[]>;
}

export interface RuntimeCredential {
   type: 'oauth' | 'api_key';
   token: string;
   accountId: string | null;
   accountName: string | null;
}

export interface AgentProcessRun {
   envelope: TaskEnvelope;
   credential: RuntimeCredential;
   workingDirectory: string;
   stateDirectory: string;
   tools: Tool[];
   emit: Emit;
   signal: AbortSignal;
}

export interface AgentProcessResult {
   text: string;
   sessionId: string;
}

/** A provider-owned agent loop. Berry supplies only admitted tools and records its events. */
export interface AgentProcessAdapter extends RuntimeAdapterBase {
   readonly identity: RuntimeAdapterIdentity & { kind: 'agent_process' };
   start(input: AgentProcessRun): Promise<AgentProcessResult>;
   resume(input: AgentProcessRun & { sessionId: string }): Promise<AgentProcessResult>;
   cancel(sessionId: string): Promise<void>;
}

/** A model client used by Berry's own loop. Kept distinct from an agent process. */
export interface DirectInferenceAdapter extends RuntimeAdapterBase {
   readonly identity: RuntimeAdapterIdentity & { kind: 'direct_inference' };
   startConversation(input: {
      credential: RuntimeCredential;
      model: string;
      messages: Array<{ role: 'user' | 'assistant'; text: string }>;
      signal: AbortSignal;
   }): AsyncIterable<RuntimeAdapterEvent>;
   resumeConversation(input: {
      credential: RuntimeCredential;
      conversationId: string;
      message: string;
      signal: AbortSignal;
   }): AsyncIterable<RuntimeAdapterEvent>;
   cancel(conversationId: string): Promise<void>;
}
