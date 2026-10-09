import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { taskEnvelopeSchema, type TaskEnvelope } from '../../../runtime/envelope.ts';
import { redactSecret } from './kiro-acp.ts';
import { KiroAgentAdapter, kiroMcpSocketPath, kiroUsageEvent, normalizeKiroUpdate, selectKiroPermission, type KiroLauncher } from './kiro.ts';
import { RuntimeAdapterError, type RuntimeCredential } from './types.ts';

const KEY = 'ksk_test_key_value_0001';
const credential: RuntimeCredential = {
   type: 'api_key',
   token: KEY,
   accountId: 'abc',
   accountName: 'Kiro subscription',
};

class ScriptedChild {
   readonly sent: unknown[] = [];
   #queue: string[] = [];
   #waiters: Array<() => void> = [];
   #done = false;
   readonly exited: Promise<{ code: number | null; error: Error | null }>;
   #finish: (value: { code: number | null; error: Error | null }) => void = () => undefined;

   constructor() {
      this.exited = new Promise((resolve) => {
         this.#finish = resolve;
      });
   }

   write(line: string): void {
      const message = JSON.parse(line) as { id?: number; method?: string; result?: { accessToken?: string } };
      this.sent.push(message);
      if (message.method === 'initialize') {
         this.#push({
            jsonrpc: '2.0',
            id: message.id,
            result: {
               protocolVersion: 1,
               agentCapabilities: { loadSession: true },
               agentInfo: { name: 'kiro-cli', version: '3.0.0' },
            },
         });
         this.#push({ jsonrpc: '2.0', id: 50, method: '_kiro/auth/getAccessToken', params: {} });
      } else if (message.method === 'session/new') {
         this.#push({
            jsonrpc: '2.0',
            id: message.id,
            result: {
               sessionId: 'sess_1',
               configOptions: [{ id: 'model', options: [{ value: 'claude-sonnet', name: 'Claude Sonnet' }] }],
            },
         });
      } else if (message.method === 'session/set_config_option') {
         this.#push({ jsonrpc: '2.0', id: message.id, result: {} });
      } else if (message.method === 'session/prompt') {
         this.#push({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
               update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: { type: 'text', text: 'Done.' },
               },
            },
         });
         this.#push({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
      }
   }

   pushLine(line: string): void {
      this.#queue.push(line);
      this.#wake();
   }

   fail(error: Error): void {
      this.#done = true;
      this.#finish({ code: null, error });
      this.#wake();
   }

   kill(): void {
      this.#done = true;
      this.#finish({ code: 0, error: null });
      this.#wake();
   }

   async *lines(): AsyncIterable<string> {
      for (;;) {
         if (this.#queue.length > 0) {
            yield this.#queue.shift() ?? '';
            continue;
         }
         if (this.#done) return;
         await new Promise<void>((resolve) => this.#waiters.push(resolve));
      }
   }

   async *errors(): AsyncIterable<string> {
      return;
   }

   #push(message: unknown): void {
      this.pushLine(JSON.stringify(message));
   }

   #wake(): void {
      const waiters = this.#waiters.splice(0);
      for (const wake of waiters) wake();
   }
}

function envelope(): TaskEnvelope {
   return taskEnvelopeSchema.parse({
      kind: 'agent',
      runtime: {
         id: 'kiro',
         executionMode: 'agent_process',
         provider: 'Kiro model service',
         billing: 'subscription',
         model: 'claude-sonnet',
         credential,
      },
      runId: 'run-1',
      sessionKey: 'agent:task:kiro',
      runtimeSessionId: `berry-${'b'.repeat(64)}`,
      agent: {
         name: 'Builder',
         instructions: 'Work carefully.',
         model: 'claude-sonnet',
         skills: [],
         mcpServers: [],
         permissions: ['read_repository'],
         tools: null,
         maxTokens: null,
         temperature: null,
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

function launcher(seen: Array<{ args: string[]; env: Record<string, string> }>): KiroLauncher {
   return (spec) => {
      seen.push({ args: spec.args, env: spec.env });
      if (spec.args[0] === '--version') {
         const child = new ScriptedChild();
         queueMicrotask(() => {
            child.pushLine('kiro-cli 3.1.0');
            child.kill();
         });
         return child;
      }
      return new ScriptedChild();
   };
}

describe('Kiro adapter', () => {
   test('answers the access-token callback and keeps the key out of the reply text', async () => {
      const seen: Array<{ args: string[]; env: Record<string, string> }> = [];
      const adapter = new KiroAgentAdapter({ launcher: launcher(seen) });
      const directory = await mkdtemp(join(tmpdir(), 'berry-kiro-run-'));
      const events: string[] = [];
      try {
         const result = await adapter.start({
            envelope: envelope(),
            credential,
            workingDirectory: directory,
            stateDirectory: join(directory, 'state'),
            tools: [],
            emit: (event) => events.push(JSON.stringify(event)),
            signal: new AbortController().signal,
         });
         assert.equal(result.text, 'Done.');
         assert.equal(result.sessionId, 'sess_1');
         const tokenReply = seen.length > 0;
         assert.equal(tokenReply, true);
         const childEnv = seen.find((call) => call.args[0] === 'acp')?.env;
         assert.equal(childEnv?.KIRO_API_KEY, KEY);
         assert.equal(childEnv?.HOME, join(directory, 'state'));
         assert.equal(events.some((event) => event.includes(KEY)), false);
      } finally {
         await rm(directory, { recursive: true, force: true });
      }
   });

   test('reports the CLI version and a missing binary', async () => {
      const present = new KiroAgentAdapter({ launcher: launcher([]) });
      const availability = await present.checkAvailability();
      assert.equal(availability.available, true);
      assert.equal(availability.version, 'kiro-cli 3.1.0');

      const missing = new KiroAgentAdapter({
         launcher: () => {
            const child = new ScriptedChild();
            const error = new Error('spawn kiro-cli ENOENT') as NodeJS.ErrnoException;
            error.code = 'ENOENT';
            queueMicrotask(() => child.fail(error));
            return child;
         },
      });
      const unavailable = await missing.checkAvailability();
      assert.equal(unavailable.available, false);
      assert.match(unavailable.reason ?? '', /not installed/);
   });

   test('allows one Berry tool call and denies native shell', () => {
      const options = [
         { optionId: 'once', name: 'Allow', kind: 'allow_once' },
         { optionId: 'always', name: 'Always', kind: 'allow_always' },
         { optionId: 'no', name: 'Deny', kind: 'reject_once' },
      ];
      const berry = selectKiroPermission(
         {
            options,
            _meta: { kiro: { mcpTool: { identity: { serverName: 'berry', toolName: 'read_issue' } } } },
         },
         new Set(['read_issue'])
      );
      assert.equal(berry.outcome.optionId, 'once');
      const shell = selectKiroPermission(
         {
            options,
            _meta: { kiro: { consent: { capability: 'shell' } } },
            toolCall: { title: 'read_issue' },
         },
         new Set(['read_issue'])
      );
      assert.equal(shell.outcome.optionId, 'no');
   });

   test('skips replayed text and redacts the key', () => {
      const state = { thinkingChars: 0, started: new Set<string>() };
      const replayed = normalizeKiroUpdate(
         {
            update: {
               sessionUpdate: 'agent_message_chunk',
               content: { type: 'text', text: 'old' },
               _meta: { kiro: { replay: true } },
            },
         },
         state
      );
      assert.deepEqual(replayed, []);
      assert.equal(redactSecret(`failed ${KEY}`, KEY).includes(KEY), false);
   });

   test('the tool socket path fits a macOS unix socket', () => {
      const path = kiroMcpSocketPath();
      assert.equal(Buffer.byteLength(path) <= 103, true);
      assert.equal(path.endsWith('.sock'), true);
   });

   test('records Kiro token usage without a dollar price', () => {
      const event = kiroUsageEvent(
         {
            stopReason: 'end_turn',
            usage: {
               inputTokens: 120,
               outputTokens: 30,
               thoughtTokens: 10,
               cachedReadTokens: 40,
               cachedWriteTokens: 5,
               totalTokens: 205,
            },
         },
         'auto'
      );
      assert.equal(event?.type, 'task.usage');
      if (event?.type !== 'task.usage') return;
      assert.equal(event.usage.inputTokens, 120);
      assert.equal(event.usage.outputTokens, 40);
      assert.equal(event.usage.cacheReadTokens, 40);
      assert.equal(event.usage.cacheWriteTokens, 5);
      assert.equal(event.usage.reportedCostMicros, null);
      assert.equal(event.usage.model, 'auto');
      const context = kiroUsageEvent(
         { sessionId: 's', update: { sessionUpdate: 'usage_update', used: 18000.9, size: 200000 } },
         'deepseek-3.2'
      );
      assert.equal(context?.type, 'task.usage');
      if (context?.type !== 'task.usage') return;
      assert.equal(context.usage.inputTokens, 18000);
      assert.equal(context.usage.model, 'deepseek-3.2');
      assert.equal(kiroUsageEvent({ usagePercentage: 15 }, 'auto'), null);
      const breakdown = kiroUsageEvent(
         {
            sessionId: 's',
            update: {
               sessionUpdate: 'session_info_update',
               _meta: {
                  kiro: {
                     kind: 'context_usage',
                     usagePercentage: 2.5,
                     breakdown: {
                        contextFiles: { tokens: 0, percent: 0 },
                        tools: { tokens: 4927, percent: 0.5 },
                        memory: { tokens: 0, percent: 0 },
                        kiroResponses: { tokens: 180, percent: 0 },
                        yourPrompts: { tokens: 4319, percent: 0.4 },
                        sessionFiles: { tokens: 0, percent: 0 },
                     },
                  },
               },
            },
         },
         'deepseek-3.2'
      );
      assert.equal(breakdown?.type, 'task.usage');
      if (breakdown?.type !== 'task.usage') return;
      assert.equal(breakdown.usage.inputTokens, 9246);
      assert.equal(breakdown.usage.outputTokens, 180);
      assert.equal(breakdown.usage.reportedCostMicros, null);
      assert.equal(
         kiroUsageEvent(
            {
               update: {
                  sessionUpdate: 'session_info_update',
                  _meta: { kiro: { kind: 'turn_completion', promptTurnSummaries: [{ unit: 'credit', usage: 0.08 }] } },
               },
            },
            'auto'
         ),
         null
      );
   });
});
