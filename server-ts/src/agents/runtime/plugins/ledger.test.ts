import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Agent, ModelContentBlockDeltaEvent, ModelStreamUpdateEvent, tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { RunTerminal } from '../../../runs/ledger.ts';
import { ScriptedModel, call, say } from '../scripted-model.ts';
import { LedgerPlugin, toolDetail, type LedgerSink } from './ledger.ts';

/**
 * What the run stream reads. The order is the product: a person watching a
 * run sees the agent say something, then call something, then the call end,
 * then the answer. A ledger written in any other order shows a tool finishing
 * before it started.
 */

function fakeLedger() {
   const rows: string[] = [];
   const ledger: LedgerSink = {
      async appendToolStarted(_runId, id, name) {
         rows.push(`started:${name}:${id}`);
      },
      async appendToolCompleted(_runId, id, ok) {
         rows.push(`completed:${id}:${ok ? 'ok' : 'failed'}`);
      },
      async appendOutput(_runId, channel, text) {
         rows.push(`${channel}:${text}`);
      },
   };
   return { rows, ledger };
}

const echo = tool({
   name: 'echo',
   description: 'echo',
   inputSchema: z.object({ text: z.string() }),
   callback: async ({ text }) => ({ text }),
});

const broken = tool({
   name: 'broken',
   description: 'throws',
   inputSchema: z.object({}),
   callback: async () => {
      throw new Error('storage is down');
   },
});

test('text, then the tool, then its end, then the answer', async () => {
   const { rows, ledger } = fakeLedger();
   const model = new ScriptedModel([call('echo', { text: 'hi' }), say('All done here.')]);
   const agent = new Agent({
      model,
      tools: [echo],
      plugins: [new LedgerPlugin({ ledger, runId: 'run' })],
      printer: false,
   });

   await agent.invoke('go');

   assert.deepEqual(rows, [
      'started:echo:call_1',
      'completed:call_1:ok',
      'progress:All done here.',
   ]);
});

test('the tool row is written while the model is still writing the call, and only once', async () => {
   const { rows, ledger } = fakeLedger();
   const agent = new Agent({
      model: new ScriptedModel([call('echo', { text: 'hi' }), say('Done.')]),
      tools: [echo],
      plugins: [new LedgerPlugin({ ledger, runId: 'run' })],
      printer: false,
   });
   let whileWriting: string[] | null = null;
   agent.addHook(ModelStreamUpdateEvent, (event) => {
      const inner = event.event;
      if (inner instanceof ModelContentBlockDeltaEvent && inner.delta.type === 'toolUseInputDelta') whileWriting = [...rows];
   });

   await agent.invoke('go');

   assert.deepEqual(whileWriting, ['started:echo:call_1']);
   assert.equal(rows.filter((row) => row.startsWith('started:')).length, 1);
});

test('a tool that throws is recorded as failed, and the run goes on', async () => {
   const { rows, ledger } = fakeLedger();
   const model = new ScriptedModel([call('broken', {}), say('I could not save it.')]);
   const agent = new Agent({
      model,
      tools: [broken],
      plugins: [new LedgerPlugin({ ledger, runId: 'run' })],
      printer: false,
   });

   const result = await agent.invoke('go');

   assert.equal(result.stopReason, 'endTurn');
   assert.ok(rows.includes('completed:call_1:failed'));
});

test('a run that went terminal stops the plugin writing, without throwing', async () => {
   const rows: string[] = [];
   const ledger: LedgerSink = {
      async appendToolStarted() {
         throw new RunTerminal();
      },
      async appendToolCompleted() {
         rows.push('completed');
      },
      async appendOutput() {
         rows.push('output');
      },
   };
   const model = new ScriptedModel([call('echo', { text: 'x' }), say('late words')]);
   const agent = new Agent({
      model,
      tools: [echo],
      plugins: [new LedgerPlugin({ ledger, runId: 'run' })],
      printer: false,
   });

   await agent.invoke('go');

   assert.deepEqual(rows, [], 'nothing is written after the ledger refused');
});

test('a file tool reports which file, how big, and how long it took', async () => {
   const completions: Array<{ id: string; extra: unknown }> = [];
   const ledger: LedgerSink = {
      async appendToolStarted() {},
      async appendToolCompleted(_runId, id, _ok, extra) {
         completions.push({ id, extra });
      },
      async appendOutput() {},
   };
   const writeFile = tool({
      name: 'write_file',
      description: 'write',
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      callback: async ({ path }) => ({ path, version: 1, saved: true }),
   });
   const model = new ScriptedModel([call('write_file', { path: 'src/App.tsx', content: 'héllo' }), say('Saved.')]);
   const agent = new Agent({ model, tools: [writeFile], plugins: [new LedgerPlugin({ ledger, runId: 'run' })], printer: false });
   await agent.invoke('go');

   const extra = completions[0]?.extra as { durationMs?: number; detail?: unknown };
   assert.equal(typeof extra.durationMs, 'number');
   // Bytes, not characters: "é" is two.
   assert.deepEqual(extra.detail, { path: 'src/App.tsx', bytes: 6 });
});

test('the file facts of each file tool, and none for other tools', () => {
   const json = (value: unknown) => ({ content: [{ json: value }] });
   assert.deepEqual(toolDetail('list_files', {}, json({ files: ['a', 'b', 'c'] })), { count: 3 });
   assert.deepEqual(
      toolDetail('read_file', { path: 'notes.md' }, json({ path: 'notes.md', sizeBytes: 2048, content: 'x' })),
      { path: 'notes.md', bytes: 2048 }
   );
   // A result that arrives as JSON text reads the same.
   assert.deepEqual(
      toolDetail('read_file', { path: 'a.md' }, { content: [{ text: JSON.stringify({ sizeBytes: 5 }) }] }),
      { path: 'a.md', bytes: 5 }
   );
   assert.deepEqual(toolDetail('write_file', { path: 'a.txt', content: 'abc' }, json({ saved: true })), {
      path: 'a.txt',
      bytes: 3,
   });
   assert.equal(toolDetail('run_command', { command: 'ls' }, json({ exitCode: 0 })), null);
   assert.equal(toolDetail('list_files', {}, json({ error: 'no' })), null);
});
