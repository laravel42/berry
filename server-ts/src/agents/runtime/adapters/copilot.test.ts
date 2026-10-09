import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type {
   ModelInfo,
   SessionConfig,
   SessionEvent,
} from '@github/copilot-sdk';
import type { Tool } from '@strands-agents/sdk';
import { taskEnvelopeSchema, type TaskEnvelope } from '../../../runtime/envelope.ts';
import type { LifecycleEvent } from '../../../runtime/lifecycle.ts';
import { authorizedAgentTools } from '../container/handler.ts';
import {
   CopilotAgentAdapter,
   normalizeCopilotEvent,
   type CopilotClientFactory,
} from './copilot.ts';
import { RuntimeAdapterError, type RuntimeCredential } from './types.ts';

const SESSION_ID = `berry-${'a'.repeat(64)}`;
const credential: RuntimeCredential = {
   type: 'oauth',
   token: 'gho_test-token',
   accountId: '42',
   accountName: 'berry-user',
};

function envelope(overrides: Partial<TaskEnvelope['agent']> = {}): TaskEnvelope {
   return taskEnvelopeSchema.parse({
      kind: 'agent',
      runtime: {
         id: 'github-copilot',
         executionMode: 'agent_process',
         provider: 'GitHub Copilot model service',
         billing: 'subscription',
         model: 'auto',
         credential,
      },
      runId: 'run-1',
      sessionKey: 'agent:task:connection',
      runtimeSessionId: SESSION_ID,
      agent: {
         name: 'Builder',
         instructions: 'Work carefully.',
         model: 'auto',
         skills: [],
         mcpServers: [],
         permissions: ['read_repository', 'run_commands'],
         tools: null,
         maxTokens: null,
         temperature: null,
         ...overrides,
      },
      task: {
         prompt: 'Inspect the repository.',
         issue: null,
         comments: [],
         dependencies: [],
         projectResources: [],
         priorWork: null,
      },
      transcript: [],
      repo: null,
      completion: null,
      env: {},
      berry: { apiUrl: 'https://berry.example', token: 'task-token' },
   });
}

function model(): ModelInfo {
   return {
      id: 'model-one',
      name: 'Model One',
      capabilities: {
         supports: { vision: true, reasoningEffort: true },
         limits: { max_context_window_tokens: 128_000 },
      },
      policy: { state: 'enabled', terms: '' },
   };
}

function event(value: unknown): SessionEvent {
   return value as SessionEvent;
}

describe('Copilot event normalization', () => {
   test('normalizes text, thinking, tools, and subscription usage', () => {
      const state = { thinkingChars: 0 };
      assert.deepEqual(
         normalizeCopilotEvent(
            event({
               id: 'm1', parentId: null, timestamp: '', ephemeral: true,
               type: 'assistant.message_delta',
               data: { messageId: 'message-1', deltaContent: 'Hello' },
            }),
            state
         ),
         [{ type: 'task.message', message: { kind: 'output', channel: 'assistant', text: 'Hello' } }]
      );
      assert.deepEqual(
         normalizeCopilotEvent(
            event({
               id: 'r1', parentId: null, timestamp: '', ephemeral: true,
               type: 'assistant.reasoning_delta',
               data: { reasoningId: 'reason-1', deltaContent: 'Think' },
            }),
            state
         ),
         [{ type: 'task.message', message: { kind: 'thinking', chars: 5, text: 'Think' } }]
      );
      assert.deepEqual(
         normalizeCopilotEvent(
            event({
               id: 't1', parentId: null, timestamp: '', type: 'tool.execution_start',
               data: { toolCallId: 'tool-1', toolName: 'read_file' },
            })
         ),
         [{
            type: 'task.message',
            message: { kind: 'tool.started', toolCallId: 'tool-1', name: 'read_file' },
         }]
      );
      assert.deepEqual(
         normalizeCopilotEvent(
            event({
               id: 'u1', parentId: null, timestamp: '', ephemeral: true,
               type: 'assistant.usage',
               data: {
                  model: 'model-one', inputTokens: 10, outputTokens: 4,
                  cacheReadTokens: 2, cacheWriteTokens: 1,
                  accounting: { usageId: 'usage-1', sequence: 1, sourceSessionId: 's' },
               },
            })
         ),
         [{
            type: 'task.usage',
            usage: {
               eventId: 'usage-1', model: 'model-one', inputTokens: 10, outputTokens: 4,
               cacheReadTokens: 2, cacheWriteTokens: 1, reportedCostMicros: null,
            },
         }]
      );
   });

   test('does not merge sub-agent output into the root answer', () => {
      assert.deepEqual(
         normalizeCopilotEvent(
            event({
               id: 'm2', parentId: null, timestamp: '', ephemeral: true, agentId: 'sub-1',
               type: 'assistant.message_delta',
               data: { messageId: 'message-2', deltaContent: 'internal' },
            })
         ),
         []
      );
   });
});

describe('Copilot adapter', () => {
   test('uses explicit user auth, discovers models, and never enables ambient login', async () => {
      const options: Array<{ useLoggedInUser?: boolean; gitHubToken?: string; env?: Record<string, string | undefined> }> = [];
      let authenticated = true;
      const factory: CopilotClientFactory = (input) => {
         options.push(input);
         return {
            start: async () => undefined,
            stop: async () => [],
            forceStop: async () => undefined,
            getStatus: async () => ({ version: '1.0.94' }),
            getAuthStatus: async () => ({ isAuthenticated: authenticated, login: 'berry-user' }),
            listModels: async () => [model()],
            getSessionMetadata: async () => undefined,
            createSession: async () => session('unused'),
            resumeSession: async () => session('unused'),
         };
      };
      const adapter = new CopilotAgentAdapter(factory);

      assert.deepEqual(await adapter.connectionStatus(credential), {
         status: 'connected', accountId: '42', accountName: 'berry-user', detail: null,
      });
      authenticated = false;
      assert.equal((await adapter.connectionStatus(credential)).status, 'expired');
      assert.deepEqual(await adapter.discoverModels(credential), [
         { id: 'model-one', name: 'Model One', reasoning: true, tools: null, policy: 'enabled' },
      ]);
      assert.ok(options.every((input) => input.useLoggedInUser === false));
      assert.ok(options.every((input) => input.env?.BERRY_KILO_API_KEY === undefined));
   });

   test('streams lifecycle events and returns the root assistant result', async () => {
      const created: SessionConfig[] = [];
      const factory: CopilotClientFactory = () => ({
         start: async () => undefined,
         stop: async () => [],
         forceStop: async () => undefined,
         getStatus: async () => ({ version: '1' }),
         getAuthStatus: async () => ({ isAuthenticated: true }),
         listModels: async () => [model()],
         getSessionMetadata: async () => undefined,
         createSession: async (config) => {
            created.push(config);
            return session('final answer', () => {
               config.onEvent?.(
                  event({
                     id: 'm', parentId: null, timestamp: '', ephemeral: true,
                     type: 'assistant.message_delta',
                     data: { messageId: 'message', deltaContent: 'final ' },
                  })
               );
               config.onEvent?.(
                  event({
                     id: 'u', parentId: null, timestamp: '', ephemeral: true,
                     type: 'assistant.usage',
                     data: { model: 'model-one', inputTokens: 3, outputTokens: 2 },
                  })
               );
            });
         },
         resumeSession: async () => session('unused'),
      });
      const adapter = new CopilotAgentAdapter(factory);
      const emitted: LifecycleEvent[] = [];
      const result = await adapter.start({
         envelope: envelope(),
         credential,
         workingDirectory: '/workspace/repo',
         stateDirectory: '/workspace/state',
         tools: [],
         emit: (entry) => emitted.push(entry),
         signal: new AbortController().signal,
      });

      assert.equal(result.text, 'final answer');
      assert.equal(created[0]?.gitHubToken, credential.token);
      assert.deepEqual(created[0]?.availableTools, ['custom:*']);
      assert.deepEqual(created[0]?.excludedTools, ['builtin:*', 'mcp:*']);
      assert.equal(emitted[0]?.type, 'task.message');
      assert.equal(emitted[1]?.type, 'task.usage');
   });

   test('aborts the provider session when Berry cancels the run', async () => {
      let aborts = 0;
      let release: (() => void) | null = null;
      let started: (() => void) | null = null;
      const began = new Promise<void>((resolve) => {
         started = resolve;
      });
      const liveSession = {
         sessionId: SESSION_ID,
         sendAndWait: async () => {
            started?.();
            await new Promise<void>((resolve) => {
               release = resolve;
            });
            return undefined;
         },
         disconnect: async () => undefined,
         abort: async () => {
            aborts += 1;
            release?.();
         },
      };
      const factory: CopilotClientFactory = () => ({
         start: async () => undefined,
         stop: async () => [],
         forceStop: async () => undefined,
         getStatus: async () => ({ version: '1' }),
         getAuthStatus: async () => ({ isAuthenticated: true }),
         listModels: async () => [model()],
         getSessionMetadata: async () => undefined,
         createSession: async () => liveSession,
         resumeSession: async () => liveSession,
      });
      const controller = new AbortController();
      const running = new CopilotAgentAdapter(factory).start({
         envelope: envelope(),
         credential,
         workingDirectory: '/workspace/repo',
         stateDirectory: '/workspace/state',
         tools: [],
         emit: () => undefined,
         signal: controller.signal,
      });
      await began;
      controller.abort();
      await assert.rejects(
         running,
         (error: unknown) =>
            error instanceof RuntimeAdapterError && error.code === 'RUNTIME_CANCELLED'
      );
      assert.equal(aborts, 1);
   });

   test('normalizes an expired provider session without leaking its raw message', async () => {
      const factory: CopilotClientFactory = () => ({
         start: async () => undefined,
         stop: async () => [],
         forceStop: async () => undefined,
         getStatus: async () => ({ version: '1' }),
         getAuthStatus: async () => ({ isAuthenticated: true }),
         listModels: async () => [model()],
         getSessionMetadata: async () => undefined,
         createSession: async (config) =>
            session('ignored', () => {
               config.onEvent?.(
                  event({
                     id: 'e', parentId: null, timestamp: '', type: 'session.error',
                     data: {
                        errorType: 'authentication',
                        message: 'raw upstream body with sensitive diagnostics',
                        statusCode: 401,
                     },
                  })
               );
            }),
         resumeSession: async () => session('unused'),
      });
      await assert.rejects(
         new CopilotAgentAdapter(factory).start({
            envelope: envelope(),
            credential,
            workingDirectory: '/workspace/repo',
            stateDirectory: '/workspace/state',
            tools: [],
            emit: () => undefined,
            signal: new AbortController().signal,
         }),
         (error: unknown) => {
            assert.ok(error instanceof RuntimeAdapterError);
            assert.equal(error.code, 'AUTH_EXPIRED');
            assert.doesNotMatch(error.message, /raw upstream body/);
            return true;
         }
      );
   });
});

describe('agent-process tool admission', () => {
   test('intersects role contract, runtime permission, and explicit exemptions', () => {
      const tools = ['run_command', 'browse_repository', 'remote_status', 'unknown'].map(fakeTool);
      const selected = authorizedAgentTools(
         tools,
         envelope({ tools: ['run_command'], permissions: ['run_commands'] }),
         {
            run_command: 'run_commands',
            browse_repository: 'read_repository',
            remote_status: null,
         },
         new Set(['remote_status'])
      );
      assert.deepEqual(selected.map((tool) => tool.name), ['run_command', 'remote_status']);
   });
});

function session(text: string, beforeReply: () => void = () => undefined) {
   return {
      sessionId: SESSION_ID,
      sendAndWait: async () => {
         beforeReply();
         return { data: { content: text } };
      },
      disconnect: async () => undefined,
      abort: async () => undefined,
   };
}

function fakeTool(name: string): Tool {
   return {
      name,
      description: name,
      toolSpec: { name, description: name },
      stream: async function* () {
         return { status: 'success', content: [] } as never;
      },
   };
}
