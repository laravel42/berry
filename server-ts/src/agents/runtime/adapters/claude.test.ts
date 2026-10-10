import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { CLAUDE_CLI_LOGIN, taskEnvelopeSchema, type TaskEnvelope } from '../../../runtime/envelope.ts';
import { leakedInvokes } from './claude-invokes.ts';
import { ClaudeAgentAdapter, type ClaudeChild, type ClaudeLauncher, type ClaudeSpawn } from './claude.ts';
import type { RuntimeCredential } from './types.ts';

const credential: RuntimeCredential = {
   type: 'oauth',
   token: CLAUDE_CLI_LOGIN,
   accountId: null,
   accountName: null,
};

class ScriptedChild implements ClaudeChild {
   #queue: string[] = [];
   #done = false;
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

   finish(code = 0): void {
      this.#done = true;
      this.#finish({ code, error: null, stderr: '' });
      this.#wake();
   }

   kill(): void {
      this.finish(0);
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
         id: 'claude',
         executionMode: 'agent_process',
         provider: 'Anthropic Claude',
         billing: 'subscription',
         model: 'sonnet',
         credential,
      },
      runId: 'run-1',
      sessionKey: 'agent:task:claude',
      runtimeSessionId: `berry-${'c'.repeat(64)}`,
      agent: {
         name: 'Builder',
         instructions: 'Work carefully.',
         model: 'sonnet',
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

function launcher(seen: ClaudeSpawn[]): ClaudeLauncher {
   return (spec) => {
      seen.push(spec);
      const child = new ScriptedChild();
      queueMicrotask(() => {
         if (spec.args[0] === '--version') {
            child.push('2.1.112 (Claude Code)');
            child.finish();
            return;
         }
         if (spec.args[0] === 'auth') {
            child.push(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', orgId: 'org-1', orgName: 'Ada' }));
            child.finish();
            return;
         }
         child.push(JSON.stringify({
            type: 'assistant',
            session_id: 'sess-1',
            message: { content: [{ type: 'text', text: 'Done.' }] },
         }));
         child.push(JSON.stringify({
            type: 'result',
            subtype: 'success',
            result: 'Done.',
            session_id: 'sess-1',
            usage: { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
         }));
         child.finish();
      });
      return child;
   };
}

test('invoke tags in a reply are the tool calls', () => {
   const calls = leakedInvokes(
      '<invoke name="list_files">\n</invoke>\n<invoke name="read_skill">\n<parameter name="name">prd-authoring</parameter>\n</invoke>'
   );
   assert.deepEqual(calls, [
      { name: 'list_files', input: {} },
      { name: 'read_skill', input: { name: 'prd-authoring' } },
   ]);
});

describe('Claude adapter', () => {
   test('uses the CLI login and does not forward an API key', async () => {
      const seen: ClaudeSpawn[] = [];
      const previous = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-pass';
      const adapter = new ClaudeAgentAdapter({ launcher: launcher(seen) });
      const directory = await mkdtemp(join(tmpdir(), 'berry-claude-run-'));
      const events: string[] = [];
      try {
         const status = await adapter.connectionStatus(credential);
         assert.equal(status.status, 'connected');
         assert.equal(status.accountName, 'Ada');
         const models = await adapter.discoverModels(credential);
         assert.equal(models[0]?.id, 'sonnet');
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
         assert.equal(result.sessionId, 'sess-1');
         assert.equal(events.some((event) => event.includes('Done.')), true);
         const run = seen.find((spec) => spec.args.includes('-p'));
         assert.ok(run);
         assert.equal(run.env.ANTHROPIC_API_KEY, undefined);
         assert.equal(run.env.HOME, process.env.HOME);
         assert.ok(run.args.includes('--model'));
         assert.ok(run.args.includes('sonnet'));
         assert.ok(run.args.includes('--tools'));
      } finally {
         if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
         else process.env.ANTHROPIC_API_KEY = previous;
         await rm(directory, { recursive: true, force: true });
      }
   });

   test('a turn of invoke tags is run and the session continues', async () => {
      const seen: ClaudeSpawn[] = [];
      const calls: Array<{ name: string; input: unknown }> = [];
      const xml =
         'I will look first.\n\n<invoke name="list_files">\n</invoke>\n<invoke name="read_skill">\n<parameter name="name">prd-authoring</parameter>\n</invoke>';
      const adapter = new ClaudeAgentAdapter({
         launcher: (spec) => {
            seen.push(spec);
            const child = new ScriptedChild();
            queueMicrotask(() => {
               const text = spec.args.includes('--resume') ? 'The timing model is turn-based.' : xml;
               child.push(JSON.stringify({
                  type: 'assistant',
                  session_id: 'sess-1',
                  message: { content: [{ type: 'text', text }] },
               }));
               child.push(JSON.stringify({
                  type: 'result',
                  subtype: 'success',
                  result: text,
                  session_id: 'sess-1',
                  usage: { input_tokens: 2, output_tokens: 8, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
               }));
               child.finish();
            });
            return child;
         },
      });
      const directory = await mkdtemp(join(tmpdir(), 'berry-claude-invoke-'));
      const events: string[] = [];
      try {
         const result = await adapter.start({
            envelope: envelope(),
            credential,
            workingDirectory: directory,
            stateDirectory: directory,
            tools: (['list_files', 'read_skill'] as const).map((name) => ({
               name,
               invoke: async (input: unknown) => {
                  calls.push({ name, input });
                  return name === 'list_files' ? { files: [] } : { found: true, name: 'prd-authoring' };
               },
            })) as never,
            emit: (event) => events.push(JSON.stringify(event)),
            signal: AbortSignal.timeout(5_000),
         });
         assert.equal(result.text, 'The timing model is turn-based.');
         assert.deepEqual(calls, [
            { name: 'list_files', input: {} },
            { name: 'read_skill', input: { name: 'prd-authoring' } },
         ]);
         assert.equal(seen.filter((spec) => spec.args.includes('-p')).length, 2);
         const continued = seen.find((spec) => spec.args.includes('--resume'));
         assert.ok(continued);
         assert.ok(continued.args.includes('sess-1'));
         assert.match(continued.stdin, /prd-authoring/);
         assert.equal(events.some((event) => event.includes('<invoke')), false);
         assert.equal(events.some((event) => event.includes('list_files')), true);
         assert.equal(events.some((event) => event.includes('I will look first.')), true);
      } finally {
         await rm(directory, { recursive: true, force: true });
      }
   });

   test('reports a missing CLI', async () => {
      const adapter = new ClaudeAgentAdapter({
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
