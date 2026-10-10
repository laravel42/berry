import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TaskEnvelope } from '../../../runtime/envelope.ts';
import type { LifecycleEvent } from '../../../runtime/lifecycle.ts';
import { firstConnectedPlacement } from '../../../runtime/ai-runtimes.ts';
import { RuntimeAdapterRegistry } from '../adapters/registry.ts';
import type { AgentProcessAdapter, AgentProcessRun } from '../adapters/types.ts';
import { completionPrompt, runRuntimeCompletion, structuredAnswer } from './runtime-completion.ts';

test('the first connected model on a tier wins, in the order it was placed', () => {
   const placed = firstConnectedPlacement(
      ['claude/opus', 'codex/gpt-5.6-sol', 'codex/gpt-5.5'],
      new Set(['codex'])
   );
   assert.deepEqual(placed, { runtimeId: 'codex', modelId: 'gpt-5.6-sol' });
   assert.equal(firstConnectedPlacement(['claude/haiku'], new Set(['codex'])), null);
});

test('a fenced JSON object is the structured answer', () => {
   assert.deepEqual(structuredAnswer('Sure.\n```json\n{"reply":"ok","patch":{"name":"Billing"}}\n```'), {
      reply: 'ok',
      patch: { name: 'Billing' },
   });
   assert.equal(structuredAnswer('no object here'), undefined);
});

test('a completion on a connected runtime asks that CLI and not the deployment model', async () => {
   const seen: { run: AgentProcessRun | null } = { run: null };
   const adapter = {
      identity: {
         id: 'codex',
         name: 'Codex',
         kind: 'agent_process' as const,
         provider: 'OpenAI',
         billing: 'subscription' as const,
         capabilities: {
            modelDiscovery: true,
            streaming: true,
            tools: true,
            sessions: true,
            cancellation: true,
            usage: true,
         },
      },
      checkAvailability: async () => ({
         available: true,
         version: '0',
         reason: null,
         protocolVersion: 1 as const,
         principalIsolation: 'workstation' as const,
      }),
      connectionStatus: async () => ({ status: 'connected' as const, accountId: null, accountName: null, detail: null }),
      disconnect: async () => undefined,
      discoverModels: async () => [],
      start: async (input: AgentProcessRun) => {
         seen.run = input;
         return { text: '```json\n{"reply":"Set a name."}\n```', sessionId: 'thread-1' };
      },
      resume: async () => {
         throw new Error('a completion does not resume');
      },
      cancel: async () => undefined,
   } satisfies AgentProcessAdapter;
   const envelope: TaskEnvelope = {
      kind: 'completion',
      runId: 'run-1',
      sessionKey: 'completion:run-1',
      runtimeSessionId: `berry-${'c'.repeat(64)}`,
      runtime: {
         id: 'codex',
         executionMode: 'agent_process',
         provider: 'OpenAI',
         billing: 'subscription',
         model: 'gpt-5.6-sol',
         credential: { type: 'oauth', token: 'codex-cli', accountId: null, accountName: 'ChatGPT' },
      },
      agent: {
         name: 'Orchestrator',
         instructions: 'Route work.',
         model: 'gpt-5.6-sol',
         skills: [],
         mcpServers: [],
         permissions: [],
         tools: null,
         maxTokens: null,
         temperature: null,
      },
      task: { prompt: 'a billing project', issue: null, comments: [], dependencies: [], projectResources: [], priorWork: null },
      transcript: [],
      repo: null,
      completion: { system: 'Draft a project.', jsonSchema: { type: 'object', properties: { reply: { type: 'string' } } } },
      env: {},
      berry: { apiUrl: 'https://berry.test', token: 't' },
   };
   const events: LifecycleEvent[] = [];
   await runRuntimeCompletion(
      envelope,
      (event) => events.push(event),
      {
         workRoot: mkdtempSync(join(tmpdir(), 'berry-runtime-completion-')),
         adapters: new RuntimeAdapterRegistry([adapter]),
      },
      new AbortController().signal
   );
   assert.equal(events[0]?.type, 'task.started');
   const completed = events.at(-1);
   assert.ok(completed?.type === 'task.completed');
   assert.deepEqual(completed.result.structured, { reply: 'Set a name.' });
   const run = seen.run;
   assert.ok(run);
   assert.equal(run.envelope.agent.instructions, 'Draft a project.');
   assert.equal(run.envelope.runtime?.model, 'gpt-5.6-sol');
   assert.equal(run.tools.length, 0);
   assert.match(completionPrompt(envelope), /a billing project/);
   assert.match(run.envelope.task.prompt, /one JSON object/);
});
