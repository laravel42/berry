import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { GROK_CLI_LOGIN, taskEnvelopeSchema, type TaskEnvelope } from '../../../runtime/envelope.ts';
import { GrokAgentAdapter, type GrokChild, type GrokLauncher, type GrokSpawn } from './grok.ts';
import type { RuntimeCredential } from './types.ts';

const credential: RuntimeCredential = {
   type: 'oauth',
   token: GROK_CLI_LOGIN,
   accountId: null,
   accountName: null,
};

class ScriptedChild implements GrokChild {
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
         id: 'grok',
         executionMode: 'agent_process',
         provider: 'xAI Grok models',
         billing: 'subscription',
         model: 'grok-4.6',
         credential,
      },
      runId: 'run-1',
      sessionKey: 'agent:task:grok',
      runtimeSessionId: `berry-${'g'.repeat(64)}`,
      agent: {
         name: 'Builder',
         instructions: 'Work carefully.',
         model: 'grok-4.6',
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

function launcher(seen: GrokSpawn[]): GrokLauncher {
   return (spec) => {
      seen.push(spec);
      const child = new ScriptedChild();
      queueMicrotask(() => {
         if (spec.args[0] === '--version') {
            child.push('grok 1.0.0');
            child.finish();
            return;
         }
         if (spec.args[0] === 'models') {
            child.push(
               JSON.stringify([
                  { id: 'grok-4.6', display_name: 'Grok 4.6' },
                  { id: 'grok-code', name: 'Grok Code' },
               ])
            );
            child.finish();
            return;
         }
         child.push(JSON.stringify({ type: 'thought', data: 'Reading the repository.' }));
         child.push(
            JSON.stringify({ type: 'tool_call', toolCallId: 'call_1', toolName: 'read_file', status: 'in_progress' })
         );
         child.push(JSON.stringify({ type: 'tool_call_update', toolCallId: 'call_1', status: 'completed' }));
         child.push(JSON.stringify({ type: 'text', data: 'Done.' }));
         child.push(
            JSON.stringify({
               type: 'usage',
               usage: { input_tokens: 4, output_tokens: 2, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 },
            })
         );
         child.push(JSON.stringify({ type: 'end', stopReason: 'end_turn', sessionId: 'session-1' }));
         child.finish();
      });
      return child;
   };
}

describe('Grok adapter', () => {
   test('uses the Grok CLI login and does not forward an API key', async () => {
      const seen: GrokSpawn[] = [];
      const previous = process.env.XAI_API_KEY;
      delete process.env.XAI_API_KEY;
      const adapter = new GrokAgentAdapter({ launcher: launcher(seen) });
      const directory = await mkdtemp(join(tmpdir(), 'berry-grok-run-'));
      const events: string[] = [];
      try {
         const status = await adapter.connectionStatus(credential);
         assert.equal(status.status, 'connected');
         const models = await adapter.discoverModels(credential);
         assert.deepEqual(models.map((model) => model.id), ['grok-4.6', 'grok-code']);
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
         assert.equal(result.sessionId, 'session-1');
         assert.equal(events.some((event) => event.includes('Done.')), true);
         assert.equal(events.some((event) => event.includes('tool.started')), true);
         const run = seen.find((spec) => spec.args.includes('-p'));
         assert.ok(run);
         assert.equal(run.env.XAI_API_KEY, undefined);
         assert.equal(run.env.HOME, process.env.HOME);
         assert.ok(run.args.includes('streaming-json'));
         assert.ok(run.args.includes('--sandbox'));
         assert.ok(run.args.includes('read-only'));
         assert.ok(run.args.includes('--model'));
         assert.ok(run.args.includes('grok-4.6'));
         assert.equal(run.args.some((arg) => arg.includes('xai-')), false);
         const config = await readFile(join(directory, '.grok', 'config.toml'), 'utf8');
         assert.match(config, /\[mcp_servers\.berry\]/);
      } finally {
         if (previous === undefined) delete process.env.XAI_API_KEY;
         else process.env.XAI_API_KEY = previous;
         await rm(directory, { recursive: true, force: true });
      }
   });

   test('refuses an API-key login', async () => {
      const previous = process.env.XAI_API_KEY;
      process.env.XAI_API_KEY = 'xai-should-not-pass';
      try {
         const adapter = new GrokAgentAdapter({ launcher: launcher([]) });
         const status = await adapter.connectionStatus(credential);
         assert.equal(status.status, 'error');
         assert.match(status.detail ?? '', /API billing/);
      } finally {
         if (previous === undefined) delete process.env.XAI_API_KEY;
         else process.env.XAI_API_KEY = previous;
      }
   });

   test('reports a missing CLI', async () => {
      const adapter = new GrokAgentAdapter({
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
