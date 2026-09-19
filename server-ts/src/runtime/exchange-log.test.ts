import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentLogEvent, redactHeaders } from './exchange-log.ts';
import type { LifecycleEvent } from './lifecycle.ts';

test("an agent run's log drops the streamed text and command output its run log already holds", () => {
   const text: LifecycleEvent = { type: 'task.message', message: { kind: 'output', channel: 'assistant', text: 'Hel' } };
   const stdout: LifecycleEvent = {
      type: 'task.message',
      message: { kind: 'command.output', commandId: 'c1', stream: 'stdout', text: 'ok\n' },
   };
   assert.equal(agentLogEvent(text), null);
   assert.equal(agentLogEvent(stdout), null);
});

test('it keeps the shape of the run: tools, commands, token use and the end', () => {
   const kept: LifecycleEvent[] = [
      { type: 'task.started' },
      { type: 'task.message', message: { kind: 'tool.started', toolCallId: 't1', name: 'assign_task' } },
      { type: 'task.message', message: { kind: 'tool.completed', toolCallId: 't1', succeeded: true } },
      { type: 'task.message', message: { kind: 'command.started', commandId: 'c1', command: 'pnpm test', cwd: null } },
      {
         type: 'task.usage',
         usage: { model: 'm', inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
      { type: 'task.failed', failure: { code: 'RUNTIME_ERROR', message: 'x', retryable: false } },
   ];
   for (const event of kept) assert.deepEqual(agentLogEvent(event), event);
});

test('a delivery keeps the paths it wrote and their size, never the file bytes', () => {
   const done: LifecycleEvent = {
      type: 'task.completed',
      result: {
         text: 'Done.',
         truncated: false,
         delivery: {
            candidate: [
               { path: 'index.html', mode: '100644', content: '<h1>PageBuilder</h1>' },
               { path: 'old.css', mode: '100644', content: null },
            ],
            committed: true,
            commit: 'abc',
            branch: 'berry/l42-342',
            filesChanged: 2,
            insertions: 1,
            deletions: 1,
            files: ['index.html', 'old.css'],
         },
      },
   };
   const logged = agentLogEvent(done);
   assert.ok(logged?.type === 'task.completed');
   assert.deepEqual(logged.result.delivery?.candidate, [
      { path: 'index.html', mode: '100644', content: '[20 bytes]' },
      { path: 'old.css', mode: '100644', content: null },
   ]);
   assert.equal(logged.result.text, 'Done.');
   assert.equal(logged.result.delivery?.branch, 'berry/l42-342');
});

test('credential headers keep their name and lose their value', () => {
   assert.deepEqual(redactHeaders({ authorization: 'AWS4 x', 'x-amz-date': '2026' }), {
      authorization: '[redacted]',
      'x-amz-date': '2026',
   });
});
