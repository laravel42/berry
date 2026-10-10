import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { CURSOR_CLI_LOGIN, taskEnvelopeSchema, type TaskEnvelope } from '../../../runtime/envelope.ts';
import { CursorAgentAdapter, type CursorChild, type CursorLauncher, type CursorSpawn } from './cursor.ts';
import type { RuntimeCredential } from './types.ts';

const credential: RuntimeCredential = {
   type: 'oauth',
   token: CURSOR_CLI_LOGIN,
   accountId: null,
   accountName: null,
};

class ScriptedChild implements CursorChild {
   #queue: string[] = [];
   #done = false;
   #stderr = '';
   #waiters: Array<() => void> = [];
   readonly exited: Promise<{ code: number | null; error: Error | null; stderr: string }>;
   #finish: (value: { code: number | null; error: Error | null; stderr: string }) => void = () => undefined;

   constructor() {
      this.exited = new Promise((resolve) => {
         this.#finish = resolve;
      });
   }

   push(line: string): void {
      this.#queue.push(line);
      this.#wake();
   }

   finish(code = 0, stderr = ''): void {
      this.#done = true;
      this.#stderr = stderr;
      this.#finish({ code, error: null, stderr });
      this.#wake();
   }

   kill(): void {
      this.finish(0, this.#stderr);
   }

   async *lines(): AsyncIterable<string> {
      for (;;) {
         const line = this.#queue.shift();
         if (line !== undefined) {
            yield line;
            continue;
         }
         if (this.#done) return;
         await new Promise<void>((resolve) => this.#waiters.push(resolve));
      }
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
         id: 'cursor',
         executionMode: 'agent_process',
         provider: 'Cursor model service',
         billing: 'subscription',
         model: 'sonnet-4.5',
         credential,
      },
      runId: 'run-1',
      sessionKey: 'agent:task:cursor',
      runtimeSessionId: `berry-${'c'.repeat(64)}`,
      agent: {
         name: 'Builder',
         instructions: 'Work carefully.',
         model: 'sonnet-4.5',
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

function launcher(seen: CursorSpawn[]): CursorLauncher {
   return (spec) => {
      seen.push(spec);
      const child = new ScriptedChild();
      queueMicrotask(() => {
         if (spec.args[0] === '--version') {
            child.push('cursor-agent 2026.1.0');
            child.finish();
            return;
         }
         if (spec.args[0] === 'status') {
            child.push('Logged in as builder@example.com');
            child.push('Status: authenticated');
            child.finish();
            return;
         }
         if (spec.args[0] === 'models') {
            child.push(JSON.stringify({ models: ['sonnet-4.5', 'gpt-5.4', 'sonnet-4.5'] }));
            child.finish();
            return;
         }
         child.push(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'chat-1' }));
         child.push(JSON.stringify({ type: 'tool_call', subtype: 'started', id: 'tool-1', name: 'read_file' }));
         child.push(JSON.stringify({ type: 'tool_call', subtype: 'completed', id: 'tool-1' }));
         child.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } }));
         child.push(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 4, output_tokens: 2 } }));
         child.finish();
      });
      return child;
   };
}

describe('Cursor adapter', () => {
   test('uses the Cursor CLI login and does not forward an API key', async () => {
      const seen: CursorSpawn[] = [];
      const previousKey = process.env.CURSOR_API_KEY;
      const previousToken = process.env.CURSOR_AUTH_TOKEN;
      process.env.CURSOR_API_KEY = 'cursor_should_not_pass';
      process.env.CURSOR_AUTH_TOKEN = 'tok-should-not-pass';
      const adapter = new CursorAgentAdapter({ launcher: launcher(seen) });
      const directory = await mkdtemp(join(tmpdir(), 'berry-cursor-run-'));
      const events: string[] = [];
      try {
         const status = await adapter.connectionStatus(credential);
         assert.equal(status.status, 'connected');
         assert.equal(status.accountName, 'Cursor');
         const models = await adapter.discoverModels(credential);
         assert.deepEqual(models.map((model) => model.id), ['sonnet-4.5', 'gpt-5.4']);
         const result = await adapter.start({
            envelope: envelope(),
            credential,
            workingDirectory: directory,
            stateDirectory: directory,
            tools: [],
            emit: (event) => events.push(JSON.stringify(event)),
            signal: AbortSignal.timeout(5_000),
         });
         assert.equal(result.text, 'Done.');
         assert.equal(result.sessionId, 'chat-1');
         assert.equal(events.some((event) => event.includes('Done.')), true);
         assert.equal(events.some((event) => event.includes('tool.started')), true);
         const run = seen.find((spec) => spec.args.includes('--print'));
         assert.ok(run);
         assert.equal(run.env.CURSOR_API_KEY, undefined);
         assert.equal(run.env.CURSOR_AUTH_TOKEN, undefined);
         assert.equal(run.env.HOME, process.env.HOME);
         assert.ok(run.args.includes('stream-json'));
         assert.ok(run.args.includes('--model'));
         assert.ok(run.args.includes('sonnet-4.5'));
         assert.equal(run.args.some((arg) => arg.includes('should-not-pass') || arg.includes('cursor_should')), false);
         // The run must not auto-approve the CLI's own write/shell/delete tools.
         assert.equal(run.args.includes('--force'), false);
         // The permissions policy denies the built-in mutating tools and allows
         // only reads and the berry MCP server, so Berry tools are the only path.
         const policy = JSON.parse(await readFile(join(directory, '.cursor', 'cli.json'), 'utf8')) as {
            permissions: { allow: string[]; deny: string[] };
         };
         assert.ok(policy.permissions.deny.includes('Write(**)'));
         assert.ok(policy.permissions.deny.includes('Shell(*)'));
         assert.ok(policy.permissions.deny.includes('Delete(**)'));
         assert.ok(policy.permissions.allow.includes('Mcp(berry:*)'));
         // The account email the CLI printed is not stored as the account name.
         assert.notEqual(status.accountName, 'builder@example.com');
      } finally {
         if (previousKey === undefined) delete process.env.CURSOR_API_KEY;
         else process.env.CURSOR_API_KEY = previousKey;
         if (previousToken === undefined) delete process.env.CURSOR_AUTH_TOKEN;
         else process.env.CURSOR_AUTH_TOKEN = previousToken;
         await rm(directory, { recursive: true, force: true });
      }
   });

   test('reports a missing login', async () => {
      const adapter = new CursorAgentAdapter({
         launcher: () => {
            const child = new ScriptedChild();
            queueMicrotask(() => {
               child.push('Not logged in. Run cursor-agent login.');
               child.finish();
            });
            return child;
         },
      });
      const status = await adapter.connectionStatus(credential);
      assert.equal(status.status, 'missing');
      assert.match(status.detail ?? '', /login/i);
   });

   test('refuses a credential that is not the CLI login sentinel', async () => {
      const adapter = new CursorAgentAdapter({ launcher: () => new ScriptedChild() });
      await assert.rejects(
         () => adapter.connectionStatus({ type: 'api_key', token: 'cursor_live', accountId: null, accountName: null }),
         /Berry uses the Cursor CLI login/
      );
   });

   test('reports a missing CLI', async () => {
      const adapter = new CursorAgentAdapter({
         launcher: () => {
            const child = new ScriptedChild();
            queueMicrotask(() => child.finish(1));
            return child;
         },
      });
      const availability = await adapter.checkAvailability();
      assert.equal(availability.available, false);
   });
});
