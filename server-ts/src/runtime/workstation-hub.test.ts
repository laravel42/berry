import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskEnvelope } from './envelope.ts';
import { createWorkstationHub, WORKSTATION_OFFLINE } from './workstation-hub.ts';
import { RuntimeUnavailable } from './transport.ts';

const USER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

test('wait times out empty when nothing is queued', async () => {
   const hub = createWorkstationHub();
   const job = await hub.wait(USER, 20);
   assert.equal(job, null);
});

test('a waiter receives a control job and posts the result', async () => {
   const hub = createWorkstationHub();
   const pending = hub.wait(USER, 1_000);
   const control = hub.control(USER, {
      runtimeSessionId: 'berry-workstation-control-session-0001',
      operation: 'availability',
      runtimeId: 'kiro',
      credential: null,
   });
   const job = await pending;
   assert.equal(job?.kind, 'control');
   if (job?.kind !== 'control') return;
   assert.equal(hub.owns(job.id, USER), true);
   assert.equal(hub.owns(job.id, OTHER), false);
   hub.completeControl(job.id, { ok: true });
   const response = await control;
   assert.equal(response.ok, true);
});

test('invoke streams events until a terminal frame', async () => {
   const hub = createWorkstationHub();
   const pending = hub.wait(USER, 1_000);
   const events: string[] = [];
   const consume = (async () => {
      for await (const event of hub.invoke(
         USER,
         { runId: 'run-1', kind: 'agent' } as TaskEnvelope,
         new AbortController().signal
      )) {
         events.push(event.type);
      }
   })();
   const job = await pending;
   assert.equal(job?.kind, 'invoke');
   if (job?.kind !== 'invoke') return;
   hub.pushEvents(job.id, [
      { type: 'task.started' },
      { type: 'task.completed', result: { text: 'done', truncated: false, delivery: null } },
   ]);
   await consume;
   assert.deepEqual(events, ['task.started', 'task.completed']);
});

test('an offline user is refused instead of queuing forever', async () => {
   const hub = createWorkstationHub();
   await assert.rejects(
      () =>
         hub.control(USER, {
            runtimeSessionId: 'berry-workstation-control-session-0001',
            operation: 'availability',
            runtimeId: 'kiro',
            credential: null,
         }),
      (error: unknown) => error instanceof RuntimeUnavailable && error.message === WORKSTATION_OFFLINE
   );
});

test('markSeen keeps a workstation present', async () => {
   const hub = createWorkstationHub();
   assert.equal(hub.isPresent('machine-1'), false);
   hub.markSeen(USER, 'machine-1');
   assert.equal(hub.isOnline(USER), true);
   assert.equal(hub.isPresent('machine-1'), true);
   assert.equal(hub.isPresent('machine-2'), false);
});
