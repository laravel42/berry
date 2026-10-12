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
import { LIST_RUN_TOOLS, LIST_RUN_TOOLS_REQUIRED, RunToolDeclaration, declaredTools, listRunToolsTool } from './run-tools.ts';

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

test('a run without the declaration tool still admits its own tools', () => {
   const declaration = new RunToolDeclaration(false);
   assert.equal(declaration.admit('write_file'), null);
});

test('other tools are refused until list_run_tools has succeeded', () => {
   const declaration = new RunToolDeclaration(true);
   assert.equal(declaration.admit('write_file'), LIST_RUN_TOOLS_REQUIRED);
   assert.equal(declaration.admit(LIST_RUN_TOOLS), null);
   declaration.note(LIST_RUN_TOOLS);
   assert.equal(declaration.admit('write_file'), null);
});

test('the berry MCP server refuses a tool until list_run_tools is called', async () => {
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
      assert.equal(early.result?.isError, true);
      assert.match(early.result?.content?.[0]?.text ?? '', /list_run_tools/);

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
