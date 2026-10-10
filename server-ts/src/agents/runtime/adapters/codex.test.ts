import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { CODEX_CLI_LOGIN, taskEnvelopeSchema, type TaskEnvelope } from '../../../runtime/envelope.ts';
import { CodexAgentAdapter, type CodexChild, type CodexLauncher, type CodexSpawn } from './codex.ts';
import type { RuntimeCredential } from './types.ts';

const credential: RuntimeCredential = {
   type: 'oauth',
   token: CODEX_CLI_LOGIN,
   accountId: null,
   accountName: null,
};

class ScriptedChild implements CodexChild {
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
         id: 'codex',
         executionMode: 'agent_process',
         provider: 'OpenAI Codex models',
         billing: 'subscription',
         model: 'gpt-5.4',
         credential,
      },
      runId: 'run-1',
      sessionKey: 'agent:task:codex',
      runtimeSessionId: `berry-${'c'.repeat(64)}`,
      agent: {
         name: 'Builder',
         instructions: 'Work carefully.',
         model: 'gpt-5.4',
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

function launcher(seen: CodexSpawn[]): CodexLauncher {
   return (spec) => {
      seen.push(spec);
      const child = new ScriptedChild();
      queueMicrotask(() => {
         if (spec.args[0] === '--version') {
            child.push('codex-cli 0.162.0');
            child.finish();
            return;
         }
         if (spec.args[0] === 'login') {
            child.finish(0, 'Logged in using ChatGPT\n');
            return;
         }
         if (spec.args[0] === 'debug') {
            child.push(JSON.stringify({
               models: [
                  { slug: 'gpt-5.4', display_name: 'GPT-5.4', visibility: 'list', supported_reasoning_levels: ['low'] },
                  { slug: 'hidden', display_name: 'Hidden', visibility: 'hide', supported_reasoning_levels: [] },
               ],
            }));
            child.finish();
            return;
         }
         child.push(JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }));
         child.push(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }));
         child.push(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 4, output_tokens: 2, cached_input_tokens: 1 } }));
         child.finish();
      });
      return child;
   };
}

describe('Codex adapter', () => {
   test('uses the ChatGPT CLI login and does not forward an API key', async () => {
      const seen: CodexSpawn[] = [];
      const previous = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'sk-should-not-pass';
      const adapter = new CodexAgentAdapter({ launcher: launcher(seen) });
      const directory = await mkdtemp(join(tmpdir(), 'berry-codex-run-'));
      const events: string[] = [];
      try {
         const status = await adapter.connectionStatus(credential);
         assert.equal(status.status, 'connected');
         assert.equal(status.accountName, 'ChatGPT');
         const models = await adapter.discoverModels(credential);
         assert.deepEqual(models.map((model) => model.id), ['gpt-5.4']);
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
         assert.equal(result.sessionId, 'thread-1');
         assert.equal(events.some((event) => event.includes('Done.')), true);
         const run = seen.find((spec) => spec.args[0] === 'exec');
         assert.ok(run);
         assert.equal(run.env.OPENAI_API_KEY, undefined);
         assert.equal(run.env.HOME, process.env.HOME);
         assert.ok(run.args.includes('--json'));
         assert.ok(run.args.includes('--sandbox'));
         assert.ok(run.args.includes('read-only'));
         assert.ok(run.args.includes('--model'));
         assert.ok(run.args.includes('gpt-5.4'));
         assert.equal(run.args.some((arg) => arg.includes('sk-')), false);
      } finally {
         if (previous === undefined) delete process.env.OPENAI_API_KEY;
         else process.env.OPENAI_API_KEY = previous;
         await rm(directory, { recursive: true, force: true });
      }
   });

   test('refuses an API-key login', async () => {
      const adapter = new CodexAgentAdapter({
         launcher: () => {
            const child = new ScriptedChild();
            queueMicrotask(() => child.finish(0, 'Logged in using an API key - sk-live\n'));
            return child;
         },
      });
      const status = await adapter.connectionStatus(credential);
      assert.equal(status.status, 'error');
      assert.match(status.detail ?? '', /API billing/);
   });

   test('reports a missing CLI', async () => {
      const adapter = new CodexAgentAdapter({
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
