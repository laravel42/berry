import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { KIMI_CLI_LOGIN, taskEnvelopeSchema, type TaskEnvelope } from '../../../runtime/envelope.ts';
import {
   KimiAgentAdapter,
   kimiMcpSocketPath,
   kimiUsageEvent,
   modelsFromSession,
   normalizeKimiUpdate,
   selectKimiPermission,
   type KimiLauncher,
} from './kimi.ts';
import { RuntimeAdapterError, type RuntimeCredential } from './types.ts';

const credential: RuntimeCredential = {
   type: 'oauth',
   token: KIMI_CLI_LOGIN,
   accountId: null,
   accountName: null,
};

class ScriptedChild {
   readonly sent: Array<{ id?: number; method?: string }> = [];
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
      const message = JSON.parse(line) as { id?: number; method?: string };
      this.sent.push(message);
      if (message.method === 'initialize') {
         this.#push({
            jsonrpc: '2.0',
            id: message.id,
            result: { protocolVersion: 1, agentInfo: { name: 'kimi', version: '1.0.0' } },
         });
      } else if (message.method === 'session/new') {
         this.#push({
            jsonrpc: '2.0',
            id: message.id,
            result: {
               sessionId: 'sess_1',
               configOptions: [{ id: 'model', options: [{ value: 'kimi-k2', name: 'Kimi K2' }] }],
            },
         });
      } else if (message.method === 'session/set_config_option') {
         this.#push({ jsonrpc: '2.0', id: message.id, result: {} });
      } else if (message.method === 'session/prompt') {
         this.#push({
            jsonrpc: '2.0',
            method: 'session/update',
            params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' } } },
         });
         this.#push({
            jsonrpc: '2.0',
            id: message.id,
            result: { stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } },
         });
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
         id: 'kimi',
         executionMode: 'agent_process',
         provider: 'Kimi Code model service',
         billing: 'subscription',
         model: 'kimi-k2',
         credential,
      },
      runId: 'run-1',
      sessionKey: 'agent:task:kimi',
      runtimeSessionId: `berry-${'d'.repeat(64)}`,
      agent: {
         name: 'Builder',
         instructions: 'Work carefully.',
         model: 'kimi-k2',
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

function launcher(seen: Array<{ args: string[]; env: Record<string, string> }>): KimiLauncher {
   return (spec) => {
      seen.push({ args: spec.args, env: spec.env });
      if (spec.args[0] === '--version') {
         const child = new ScriptedChild();
         queueMicrotask(() => {
            child.pushLine('kimi 1.2.3');
            child.kill();
         });
         return child;
      }
      return new ScriptedChild();
   };
}

describe('Kimi adapter', () => {
   test('runs over ACP with the CLI login and forwards no API key', async () => {
      const seen: Array<{ args: string[]; env: Record<string, string> }> = [];
      const previous = process.env.MOONSHOT_API_KEY;
      process.env.MOONSHOT_API_KEY = 'sk-should-not-pass';
      const adapter = new KimiAgentAdapter({ launcher: launcher(seen) });
      const directory = await mkdtemp(join(tmpdir(), 'berry-kimi-run-'));
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
         const run = seen.find((call) => call.args[0] === 'acp');
         assert.ok(run);
         assert.deepEqual(run.args, ['acp']);
         assert.equal(run.env.MOONSHOT_API_KEY, undefined);
         assert.equal(Object.values(run.env).some((value) => value.includes('sk-')), false);
         assert.equal(events.some((event) => event.includes('Done.')), true);
         assert.equal(events.some((event) => event.includes('task.usage')), true);
      } finally {
         if (previous === undefined) delete process.env.MOONSHOT_API_KEY;
         else process.env.MOONSHOT_API_KEY = previous;
         await rm(directory, { recursive: true, force: true });
      }
   });

   test('refuses a credential that is not the CLI login sentinel', async () => {
      const adapter = new KimiAgentAdapter({ launcher: launcher([]) });
      await assert.rejects(
         () => adapter.discoverModels({ type: 'api_key', token: 'sk-live', accountId: null, accountName: null }),
         (error: unknown) => error instanceof RuntimeAdapterError && error.code === 'AUTH_REQUIRED'
      );
   });

   test('an unsigned Kimi CLI surfaces as missing via the ACP -32000 auth error', async () => {
      // ACP reserves -32000 for "Authentication required": what an ACP agent
      // returns from session/new when its own login is missing. Berry forwards
      // no credential, so this is the unsigned-CLI path.
      const authRequiredLauncher: KimiLauncher = () => {
         const child = new ScriptedChild();
         const originalWrite = child.write.bind(child);
         child.write = (line: string) => {
            const message = JSON.parse(line) as { id?: number; method?: string };
            if (message.method === 'session/new') {
               child.pushLine(
                  JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Authentication required' } })
               );
               return;
            }
            originalWrite(line);
         };
         return child;
      };
      const adapter = new KimiAgentAdapter({ launcher: authRequiredLauncher });
      const status = await adapter.connectionStatus(credential);
      assert.equal(status.status, 'missing');
      assert.match(status.detail ?? '', /login|signed in/i);
   });

   test('reports the CLI version and a missing binary', async () => {
      const present = new KimiAgentAdapter({ launcher: launcher([]) });
      const availability = await present.checkAvailability();
      assert.equal(availability.available, true);
      assert.equal(availability.version, 'kimi 1.2.3');

      const missing = new KimiAgentAdapter({
         launcher: () => {
            const child = new ScriptedChild();
            const error = new Error('spawn kimi ENOENT') as NodeJS.ErrnoException;
            error.code = 'ENOENT';
            queueMicrotask(() => child.fail(error));
            return child;
         },
      });
      const unavailable = await missing.checkAvailability();
      assert.equal(unavailable.available, false);
      assert.match(unavailable.reason ?? '', /not installed/);
   });

   test('lists models from the session config options', () => {
      const models = modelsFromSession({
         sessionId: 's',
         configOptions: [{ id: 'model', options: [{ value: 'kimi-k2', name: 'Kimi K2' }, { value: 'kimi-mini' }] }],
      });
      assert.deepEqual(models.map((model) => model.id), ['kimi-k2', 'kimi-mini']);
      assert.equal(models[1]?.name, 'kimi-mini');
   });

   test('approves a Berry tool from the standard ACP request_permission shape', () => {
      const options = [
         { optionId: 'once', name: 'Allow', kind: 'allow_once' },
         { optionId: 'no', name: 'Deny', kind: 'reject_once' },
      ];
      const allowed = new Set(['read_issue']);
      // Standard ACP v1 payload: the tool is named by toolCall.name. The Kimi
      // child only has the Berry MCP server as its tool source, so an allowed
      // name is a Berry tool and is approved.
      const byName = selectKimiPermission({ options, toolCall: { toolCallId: 't1', name: 'read_issue' } }, allowed);
      assert.equal(byName.outcome.optionId, 'once');
      // Resolve from title when name is absent.
      const byTitle = selectKimiPermission({ options, toolCall: { toolCallId: 't2', title: 'read_issue' } }, allowed);
      assert.equal(byTitle.outcome.optionId, 'once');
      // A Berry server qualifier on the name is stripped before the allow-set check.
      for (const qualified of ['berry__read_issue', 'mcp__berry__read_issue', 'berry.read_issue', 'berry/read_issue']) {
         const q = selectKimiPermission({ options, toolCall: { toolCallId: 'q', name: qualified } }, allowed);
         assert.equal(q.outcome.optionId, 'once', qualified);
      }
      // A tool not in the allow-set is denied.
      const unknown = selectKimiPermission({ options, toolCall: { toolCallId: 't3', name: 'run_shell' } }, allowed);
      assert.equal(unknown.outcome.optionId, 'no');
      // When an explicit MCP identity is present, a non-Berry server is denied
      // even if its tool name is in the allow-set.
      const otherServer = selectKimiPermission(
         { options, toolCall: { toolCallId: 't4', name: 'read_issue' }, _meta: { mcpTool: { identity: { serverName: 'other', toolName: 'read_issue' } } } },
         allowed
      );
      assert.equal(otherServer.outcome.optionId, 'no');
      // An explicit Berry MCP identity is honored.
      const berryIdentity = selectKimiPermission(
         { options, _meta: { mcpTool: { identity: { serverName: 'berry', toolName: 'read_issue' } } } },
         allowed
      );
      assert.equal(berryIdentity.outcome.optionId, 'once');
   });

   test('skips replayed text and records usage without a dollar price', () => {
      const state = { thinkingChars: 0, started: new Set<string>() };
      const replayed = normalizeKimiUpdate(
         { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old' }, _meta: { replay: true } } },
         state
      );
      assert.deepEqual(replayed, []);
      const event = kimiUsageEvent({ usage: { inputTokens: 120, outputTokens: 30, cachedReadTokens: 40 } }, 'kimi-k2');
      assert.equal(event?.type, 'task.usage');
      if (event?.type !== 'task.usage') return;
      assert.equal(event.usage.inputTokens, 120);
      assert.equal(event.usage.outputTokens, 30);
      assert.equal(event.usage.cacheReadTokens, 40);
      assert.equal(event.usage.reportedCostMicros, null);
      assert.equal(event.usage.model, 'kimi-k2');
      assert.equal(kimiUsageEvent({ update: { creditsUsed: 0.08 } }, 'kimi-k2'), null);
   });

   test('the tool socket path fits a macOS unix socket', () => {
      const path = kimiMcpSocketPath();
      assert.equal(Buffer.byteLength(path) <= 103, true);
      assert.equal(path.endsWith('.sock'), true);
   });
});
