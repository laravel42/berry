import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { describe, test } from 'node:test';
import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { GROK_CLI_LOGIN, taskEnvelopeSchema, type TaskEnvelope } from '../../../runtime/envelope.ts';
import { BerryMcpHost } from './kiro-mcp.ts';
import { GrokAgentAdapter, grokMcpBridgePath, type GrokChild, type GrokLauncher, type GrokSpawn } from './grok.ts';
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

/** A launcher whose `models` probe exits with the given code, to test auth detection. */
function launcher(seen: GrokSpawn[], options: { modelsExit?: number } = {}): GrokLauncher {
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
            if ((options.modelsExit ?? 0) !== 0) {
               child.finish(options.modelsExit, 'Not signed in. Run `grok login`.\n');
               return;
            }
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
   test('runs on the CLI login, writes nothing into the checkout, forwards no API key', async () => {
      const seen: GrokSpawn[] = [];
      const previous = process.env.XAI_API_KEY;
      delete process.env.XAI_API_KEY;
      const adapter = new GrokAgentAdapter({ launcher: launcher(seen) });
      const workingDirectory = await mkdtemp(join(tmpdir(), 'berry-grok-cwd-'));
      const stateDirectory = await mkdtemp(join(tmpdir(), 'berry-grok-state-'));
      const events: string[] = [];
      try {
         const status = await adapter.connectionStatus(credential);
         assert.equal(status.status, 'connected');
         const models = await adapter.discoverModels(credential);
         assert.deepEqual(models.map((model) => model.id), ['grok-4.6', 'grok-code']);
         const result = await adapter.start({
            envelope: envelope(),
            credential,
            workingDirectory,
            stateDirectory,
            tools: [],
            emit: (event) => events.push(JSON.stringify(event)),
            signal: AbortSignal.timeout(5_000),
         });
         assert.equal(result.text, 'Done.');
         assert.equal(result.sessionId, 'session-1');
         assert.equal(events.some((event) => event.includes('Done.')), true);
         assert.equal(events.some((event) => event.includes('tool.started')), true);

         const run = seen.find((spec) => spec.args.includes('--prompt-file'));
         assert.ok(run, 'the run passes the prompt as a file, not an argv string');
         // The prompt is a file path, and the prompt text is not an argv entry.
         const promptPath = run.args[run.args.indexOf('--prompt-file') + 1];
         assert.ok(typeof promptPath === 'string' && promptPath.endsWith('prompt.txt'));
         assert.equal(run.args.some((arg) => arg.includes('Inspect the repository')), false);
         const promptBody = await readFile(promptPath, { encoding: 'utf8' });
         assert.match(promptBody, /Inspect the repository/);

         // No API key reaches the child; the subscription session owns the run.
         assert.equal(run.env.XAI_API_KEY, undefined);
         assert.ok(run.args.includes('streaming-json'));
         // A writable checkout: the workspace sandbox, not read-only.
         assert.equal(run.args[run.args.indexOf('--sandbox') + 1], 'workspace');
         assert.ok(run.args.includes('--model'));
         assert.ok(run.args.includes('grok-4.6'));
         assert.equal(run.args.some((arg) => arg.includes('xai-')), false);

         // The MCP config is written into a private per-run GROK_HOME under the
         // state directory, never into the committed working directory.
         assert.ok(run.env.GROK_HOME && run.env.GROK_HOME.startsWith(stateDirectory));
         const config = await readFile(join(run.env.GROK_HOME, 'config.toml'), 'utf8');
         assert.match(config, /\[mcp_servers\.berry\]/);
         await assert.rejects(access(join(workingDirectory, '.grok', 'config.toml')));
      } finally {
         if (previous === undefined) delete process.env.XAI_API_KEY;
         else process.env.XAI_API_KEY = previous;
         await rm(workingDirectory, { recursive: true, force: true });
         await rm(stateDirectory, { recursive: true, force: true });
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

   test('a non-zero `grok models` reads as signed out, not connected', async () => {
      const previous = process.env.XAI_API_KEY;
      delete process.env.XAI_API_KEY;
      try {
         const adapter = new GrokAgentAdapter({ launcher: launcher([], { modelsExit: 1 }) });
         const status = await adapter.connectionStatus(credential);
         assert.equal(status.status, 'missing');
         await assert.rejects(adapter.discoverModels(credential), /grok login/);
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

   test('uses the newline-delimited (not Content-Length) MCP bridge', () => {
      // Grok's embedded MCP client speaks the standard MCP stdio transport
      // (newline-delimited JSON-RPC), the same as Kiro and Kimi. The Claude
      // bridge translates Content-Length framing and would break Grok tool
      // calls. Guard the choice so it cannot regress.
      assert.ok(grokMcpBridgePath().endsWith('kiro-mcp-bridge.ts'), grokMcpBridgePath());
   });

   // The central tool-call path: a Berry tool reached through the real bridge
   // Grok's config.toml points at, over the real BerryMcpHost socket, with
   // newline-delimited JSON-RPC framing. This is what proves repository work
   // can happen, which the scripted-launcher tests above cannot show.
   test('a Berry tool runs through the real MCP bridge over newline-delimited JSON-RPC', async () => {
      const controller = new AbortController();
      const workingDirectory = await mkdtemp(join(tmpdir(), 'berry-grok-mcp-'));
      // A short /tmp path: the macOS sockaddr_un limit is 104 bytes, and os.tmpdir()
   // can be long. Mirrors Kimi's socket-path choice.
   const socketRoot = process.platform === 'win32' ? tmpdir() : '/tmp';
   const socketPath = join(socketRoot, `bgt-${randomBytes(6).toString('hex')}.sock`);
      const ran: Array<{ note: string }> = [];
      const echo = tool({
         name: 'echo_note',
         description: 'Records and echoes a note, to prove a Berry tool executed.',
         inputSchema: z.object({ note: z.string() }),
         callback: async ({ note }: { note: string }) => {
            ran.push({ note });
            return { echoed: note };
         },
      });
      const host = new BerryMcpHost(socketPath, [echo], workingDirectory, controller.signal);
      await host.listen();

      // Spawn the exact bridge the adapter configures, exactly as Grok would:
      // `node --experimental-strip-types <bridge> <socket>`. Berry's end of
      // the socket is the real tool host; the bridge's stdio is the CLI side.
      const bridge = spawn(process.execPath, ['--experimental-strip-types', grokMcpBridgePath(), socketPath], {
         stdio: ['pipe', 'pipe', 'inherit'],
      });

      const replies: Array<{ id?: number; result?: unknown; error?: unknown }> = [];
      const waiters = new Map<number, (value: { id?: number; result?: unknown }) => void>();
      createInterface({ input: bridge.stdout }).on('line', (line) => {
         const trimmed = line.trim();
         if (trimmed === '') return;
         const message = JSON.parse(trimmed) as { id?: number; result?: unknown; error?: unknown };
         replies.push(message);
         if (typeof message.id === 'number') waiters.get(message.id)?.(message);
      });

      const call = (payload: { id: number; method: string; params?: unknown }): Promise<{ id?: number; result?: unknown }> => {
         const settled = new Promise<{ id?: number; result?: unknown }>((resolve) => waiters.set(payload.id, resolve));
         // Standard MCP stdio framing: one JSON object per line, newline-terminated.
         bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...payload })}\n`);
         return settled;
      };

      try {
         const initialized = await call({ id: 1, method: 'initialize', params: {} });
         assert.equal((initialized.result as { serverInfo?: { name?: string } }).serverInfo?.name, 'berry');

         const listed = await call({ id: 2, method: 'tools/list' });
         const tools = (listed.result as { tools?: Array<{ name?: string }> }).tools ?? [];
         assert.deepEqual(tools.map((entry) => entry.name), ['echo_note']);

         const called = await call({
            id: 3,
            method: 'tools/call',
            params: { name: 'echo_note', arguments: { note: 'hello from grok' } },
         });
         const result = called.result as { content?: Array<{ text?: string }>; isError?: boolean };
         assert.equal(result.isError, false);
         assert.match(result.content?.[0]?.text ?? '', /hello from grok/);
         // The tool really executed on Berry's side, not just echoed framing.
         assert.deepEqual(ran, [{ note: 'hello from grok' }]);
      } finally {
         bridge.stdin.end();
         bridge.kill('SIGTERM');
         controller.abort();
         await host.close();
         await rm(workingDirectory, { recursive: true, force: true });
      }
   });
});
