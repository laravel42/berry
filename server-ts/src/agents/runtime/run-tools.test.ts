import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { BerryMcpHost } from './adapters/kiro-mcp.ts';
import { SANDBOX_COMMANDS, sandboxCommandsContract } from '../sandbox-commands.ts';
import { LIST_RUN_TOOLS, RunToolDeclaration, declaredTools, listRunToolsTool, runToolInventory } from './run-tools.ts';

test('the declaration names the run tools and leaves itself out', () => {
   const declared = listRunToolsTool([
      { name: 'write_file', description: 'Save a file on the task.' },
      { name: 'run_command', description: 'Run one command.' },
   ]);
   assert.equal(declared.name, LIST_RUN_TOOLS);
   assert.deepEqual(declaredTools([
      { name: LIST_RUN_TOOLS, description: 'Declare.' },
      { name: 'write_file', description: 'Save a file on the task.' },
   ]), [{ name: 'write_file', description: 'Save a file on the task.' }]);
});

test('the sandbox command list is the programs the contract names', () => {
   const contract = sandboxCommandsContract();
   for (const command of SANDBOX_COMMANDS) {
      const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(contract, new RegExp(`(?:^|[\\s,])${escaped}(?=$|[\\s,)])`, 'm'));
   }
});

test('list_run_tools returns admitted aliases and sandbox commands that are not aliases', () => {
   const unknown = runToolInventory([{ name: 'run_command', description: 'Run one command.' }]);
   assert.deepEqual(unknown.aliases, []);
   assert.equal(unknown.nativeAliases, 'No native aliases are supported.');
   assert.ok(unknown.commands.includes('git'));
   assert.ok(unknown.commands.includes('grep'));
   assert.ok(unknown.commands.includes('bash'));

   const claude = runToolInventory(
      [
         { name: 'run_command', description: 'Run one command.' },
         { name: 'read_repository_file', description: 'Read a file.' },
      ],
      'claude'
   );
   assert.equal(claude.nativeAliases, undefined);
   assert.ok(claude.aliases.some((entry) => entry.name === 'Bash' && entry.berry.includes('run_command')));
   assert.ok(claude.aliases.some((entry) => entry.name === 'Read' && entry.berry.includes('read_repository_file')));
   assert.equal(claude.aliases.some((entry) => entry.name === 'NotebookRead'), false);
   assert.equal(claude.aliases.some((entry) => entry.name === 'Edit'), false);
   assert.ok(claude.commands.includes('bash'));
   assert.ok(claude.commands.includes('git'));

   const kiro = runToolInventory(
      [
         { name: 'run_command', description: 'Run one command.' },
         { name: 'read_repository_file', description: 'Read a file.' },
      ],
      'kiro'
   );
   assert.ok(kiro.aliases.some((entry) => entry.name === 'execute_bash'));
   assert.ok(kiro.aliases.some((entry) => entry.name === 'grep'));
   assert.ok(kiro.aliases.some((entry) => entry.name === 'read' && entry.berry.includes('read_repository_file')));
   assert.ok(kiro.aliases.some((entry) => entry.name === 'read_file'));
   assert.equal(kiro.aliases.some((entry) => entry.name === 'grepSearch'), false);
   assert.equal(kiro.aliases.some((entry) => entry.name === 'readFile'), false);
   assert.equal(kiro.aliases.some((entry) => entry.name === 'read_files'), false);
   assert.equal(kiro.commands.includes('grep'), false);
   assert.ok(kiro.commands.includes('git'));
   assert.ok(kiro.commands.includes('bash'));

   const cursor = runToolInventory([{ name: 'run_command', description: 'Run one command.' }], 'cursor');
   assert.ok(cursor.aliases.some((entry) => entry.name === 'Shell'));
   assert.ok(cursor.aliases.some((entry) => entry.name === 'shell'));
   assert.equal(cursor.aliases.some((entry) => entry.name === 'Bash'), false);

   const grok = runToolInventory(
      [
         { name: 'edit_file', description: 'Edit.' },
         { name: 'run_command', description: 'Run one command.' },
      ],
      'grok'
   );
   assert.ok(grok.aliases.some((entry) => entry.name === 'search_replace' && entry.berry.includes('edit_file')));
   assert.equal(grok.aliases.some((entry) => entry.name === 'apply_patch'), false);
   assert.equal(grok.aliases.some((entry) => entry.name === 'edit_file'), false);
   assert.ok(grok.aliases.some((entry) => entry.name === 'grep'));
   assert.equal(grok.aliases.some((entry) => entry.name === 'grep_search'), false);
   assert.ok(grok.aliases.some((entry) => entry.name === 'run_terminal_command'));
   assert.equal(grok.aliases.some((entry) => entry.name === 'bash'), false);
   assert.ok(grok.commands.includes('bash'));
   assert.equal(grok.commands.includes('grep'), false);

   const named = runToolInventory([{ name: 'fetch_url', description: 'Fetch.' }], 'not-a-runtime');
   assert.equal(named.nativeAliases, 'No native aliases are supported.');
   assert.deepEqual(named.aliases, []);
   assert.ok(named.commands.includes('curl'));
});

test('a run without the declaration tool still admits its own tools', () => {
   const declaration = new RunToolDeclaration(false);
   assert.equal(declaration.admit('write_file'), null);
});

test('other tools are admitted without list_run_tools', () => {
   const declaration = new RunToolDeclaration(true);
   assert.equal(declaration.admit('write_file'), null);
   assert.equal(declaration.admit(LIST_RUN_TOOLS), null);
   declaration.note(LIST_RUN_TOOLS);
   assert.equal(declaration.admit('run_command'), null);
});

test('the berry MCP server answers a tool without a prior list_run_tools call', async () => {
   const controller = new AbortController();
   const workingDirectory = await mkdtemp(join(tmpdir(), 'berry-run-tools-'));
   const socketPath = join(process.platform === 'win32' ? tmpdir() : '/tmp', `brt-${randomBytes(6).toString('hex')}.sock`);
   const echo = tool({
      name: 'echo_note',
      description: 'Echo a note.',
      inputSchema: z.object({ note: z.string() }),
      callback: ({ note }: { note: string }) => ({ echoed: note }),
   });
   const host = new BerryMcpHost(
      socketPath,
      [listRunToolsTool([{ name: echo.name, description: echo.description }]), echo],
      workingDirectory,
      controller.signal
   );
   await host.listen();
   const socket = connect(socketPath);
   await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', reject);
   });
   const lines = createInterface({ input: socket });
   const pending = new Map<number, (value: { result?: { isError?: boolean; content?: Array<{ text?: string }> } }) => void>();
   lines.on('line', (line) => {
      const message = JSON.parse(line) as { id?: number; result?: { isError?: boolean; content?: Array<{ text?: string }> } };
      if (typeof message.id === 'number') pending.get(message.id)?.(message);
   });
   const call = (id: number, method: string, params?: unknown) =>
      new Promise<{ result?: { isError?: boolean; content?: Array<{ text?: string }> } }>((resolve) => {
         pending.set(id, resolve);
         socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
   try {
      const early = await call(1, 'tools/call', { name: 'echo_note', arguments: { note: 'too soon' } });
      assert.equal(early.result?.isError, false);
      assert.match(early.result?.content?.[0]?.text ?? '', /too soon/);

      const declared = await call(2, 'tools/call', { name: LIST_RUN_TOOLS, arguments: {} });
      assert.equal(declared.result?.isError, false);
      assert.match(declared.result?.content?.[0]?.text ?? '', /echo_note/);
      assert.doesNotMatch(declared.result?.content?.[0]?.text ?? '', new RegExp(`"name":"${LIST_RUN_TOOLS}"`));

      const later = await call(3, 'tools/call', { name: 'echo_note', arguments: { note: 'after' } });
      assert.equal(later.result?.isError, false);
      assert.match(later.result?.content?.[0]?.text ?? '', /after/);
   } finally {
      socket.end();
      controller.abort();
      await host.close();
      await rm(workingDirectory, { recursive: true, force: true });
   }
});
