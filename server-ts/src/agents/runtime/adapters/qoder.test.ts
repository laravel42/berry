import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { QODER_CLI_LOGIN, taskEnvelopeSchema, type TaskEnvelope } from '../../../runtime/envelope.ts';
import {
   normalizeQoderUpdate,
   qoderMcpSocketPath,
   qoderUsageEvent,
   QoderAgentAdapter,
   selectQoderPermission,
   type QoderLauncher,
} from './qoder.ts';
import { type RuntimeCredential } from './types.ts';

const credential: RuntimeCredential = {
   type: 'oauth',
   token: QODER_CLI_LOGIN,
   accountId: null,
   accountName: 'Qoder',
};

class ScriptedChild {
   readonly sent: unknown[] = [];
   #queue: string[] = [];
   #errQueue: string[] = [];
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
         this.#push({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } });
      } else if (message.method === 'session/new') {
         this.#push({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'sess_q1' } });
      } else if (message.method === 'session/set_config_option') {
         this.#push({ jsonrpc: '2.0', id: message.id, result: {} });
      } else if (message.method === 'session/prompt') {
         this.#push({
            jsonrpc: '2.0',
            method: 'session/update',
            params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' } } },
         });
         this.#push({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
      }
   }

   pushLine(line: string): void {
      this.#queue.push(line);
      this.#wake();
   }

   pushError(line: string): void {
      this.#errQueue.push(line);
      this.#wake();
   }

   fail(error: Error): void {
      this.#done = true;
      this.#finish({ code: null, error });
      this.#wake();
   }

   /** Resolve the child with an explicit exit code, like a real process. */
   exit(code: number): void {
      this.#done = true;
      this.#finish({ code, error: null });
      this.#wake();
   }

   kill(): void {
      this.exit(0);
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
      for (;;) {
         if (this.#errQueue.length > 0) {
            yield this.#errQueue.shift() ?? '';
            continue;
         }
         if (this.#done) return;
         await new Promise<void>((resolve) => this.#waiters.push(resolve));
      }
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
         id: 'qoder',
         executionMode: 'agent_process',
         provider: 'Qoder model service',
         billing: 'subscription',
         model: 'qoder-default',
         credential,
      },
      runId: 'run-q',
      sessionKey: 'agent:task:qoder',
      runtimeSessionId: `berry-${'q'.repeat(64)}`,
      agent: {
         name: 'Builder',
         instructions: 'Work carefully.',
         model: 'qoder-default',
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

function launcher(seen: Array<{ args: string[]; env: Record<string, string>; cwd: string }>): QoderLauncher {
   return (spec) => {
      seen.push({ args: spec.args, env: spec.env, cwd: spec.cwd });
      if (spec.args[0] === '--version') {
         const child = new ScriptedChild();
         queueMicrotask(() => {
            child.pushLine('qoder 1.2.0');
            child.kill();
         });
         return child;
      }
      if (spec.args[0] === '--list-models') {
         const child = new ScriptedChild();
         queueMicrotask(() => {
            child.pushLine(JSON.stringify({ models: [{ id: 'qoder-default', name: 'Qoder Default' }] }));
            child.kill();
         });
         return child;
      }
      return new ScriptedChild();
   };
}

describe('Qoder adapter', () => {
   test('runs over ACP in the task checkout without forwarding any credential', async () => {
      const seen: Array<{ args: string[]; env: Record<string, string>; cwd: string }> = [];
      const adapter = new QoderAgentAdapter({ launcher: launcher(seen) });
      const directory = await mkdtemp(join(tmpdir(), 'berry-qoder-run-'));
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
         assert.equal(result.sessionId, 'sess_q1');
         const acp = seen.find((call) => call.args[0] === '--acp');
         assert.ok(acp, 'the CLI is started as an ACP server');
         // The ACP process runs in the task checkout, not the server's own directory.
         assert.equal(acp?.cwd, directory);
         // Berry forwards no account token or API key into the child environment.
         for (const value of Object.values(acp?.env ?? {})) {
            assert.equal(value.includes(QODER_CLI_LOGIN), false);
         }
         assert.equal(acp?.env.QODER_API_KEY, undefined);
         assert.equal(acp?.env.QODER_PERSONAL_ACCESS_TOKEN, undefined);
      } finally {
         await rm(directory, { recursive: true, force: true });
      }
   });

   test('reports the CLI version and a missing binary', async () => {
      const present = new QoderAgentAdapter({ launcher: launcher([]) });
      const availability = await present.checkAvailability();
      assert.equal(availability.available, true);
      assert.equal(availability.version, 'qoder 1.2.0');

      const missing = new QoderAgentAdapter({
         launcher: () => {
            const child = new ScriptedChild();
            const error = new Error('spawn qoder ENOENT') as NodeJS.ErrnoException;
            error.code = 'ENOENT';
            queueMicrotask(() => child.fail(error));
            return child;
         },
      });
      const unavailable = await missing.checkAvailability();
      assert.equal(unavailable.available, false);
      assert.match(unavailable.reason ?? '', /not installed/);
   });

   test('lists models from the signed-in CLI and reports connected', async () => {
      const adapter = new QoderAgentAdapter({ launcher: launcher([]) });
      const models = await adapter.discoverModels(credential);
      assert.equal(models.length, 1);
      assert.equal(models[0]?.id, 'qoder-default');
      const status = await adapter.connectionStatus(credential);
      assert.equal(status.status, 'connected');
   });

   test('reports a signed-out CLI as missing, not connected', async () => {
      const adapter = new QoderAgentAdapter({
         launcher: () => {
            const child = new ScriptedChild();
            queueMicrotask(() => {
               child.pushError('Error: not authenticated. Please sign in with /login.');
               child.exit(1);
            });
            return child;
         },
      });
      const status = await adapter.connectionStatus(credential);
      assert.equal(status.status, 'missing');
      await assert.rejects(adapter.discoverModels(credential), /sign in/i);
   });

   test('surfaces a CLI or flag failure as an error, never a false signed-out', async () => {
      const adapter = new QoderAgentAdapter({
         launcher: () => {
            const child = new ScriptedChild();
            queueMicrotask(() => {
               child.pushError("error: unknown option '--list-models'");
               child.exit(2);
            });
            return child;
         },
      });
      const status = await adapter.connectionStatus(credential);
      assert.equal(status.status, 'error');
      assert.match(status.detail ?? '', /list-models/);
   });

   test('refuses a credential that is not the Qoder CLI login', async () => {
      const adapter = new QoderAgentAdapter({ launcher: launcher([]) });
      await assert.rejects(
         adapter.discoverModels({ type: 'api_key', token: 'pat_123', accountId: null, accountName: null }),
         /Qoder CLI login/
      );
   });

   test('allows a Berry tool call and denies anything else', () => {
      const options = [
         { optionId: 'once', name: 'Allow', kind: 'allow_once' },
         { optionId: 'no', name: 'Deny', kind: 'reject_once' },
      ];
      const allow = selectQoderPermission(
         { options, toolCall: { title: 'berry/read_issue' } },
         new Set(['read_issue'])
      );
      assert.equal(allow.outcome.optionId, 'once');
      const deny = selectQoderPermission(
         { options, toolCall: { title: 'shell' } },
         new Set(['read_issue'])
      );
      assert.equal(deny.outcome.optionId, 'no');
   });

   test('normalizes assistant text and records usage without a price', () => {
      const state = { thinkingChars: 0, started: new Set<string>() };
      const events = normalizeQoderUpdate(
         { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } } },
         state
      );
      assert.equal(events.length, 1);
      const usage = qoderUsageEvent({ usage: { inputTokens: 100, outputTokens: 20 } }, 'qoder-default');
      assert.equal(usage?.type, 'task.usage');
      if (usage?.type !== 'task.usage') return;
      assert.equal(usage.usage.inputTokens, 100);
      assert.equal(usage.usage.outputTokens, 20);
      assert.equal(usage.usage.reportedCostMicros, null);
   });

   test('the tool socket path fits a macOS unix socket', () => {
      const path = qoderMcpSocketPath();
      assert.equal(Buffer.byteLength(path) <= 103, true);
      assert.equal(path.endsWith('.sock'), true);
   });
});
