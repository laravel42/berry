import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskEnvelope } from './envelope.ts';
import { createWorkstationHub } from './workstation-hub.ts';
import { workstationKiro } from './workstation-kiro.ts';
import { RuntimeUnavailable } from './transport.ts';

const USER = '11111111-1111-1111-1111-111111111111';
const AVAILABILITY = {
   ok: true as const,
   availability: {
      available: true,
      version: 'kiro-cli 3',
      reason: null,
      protocolVersion: 1 as const,
      principalIsolation: 'workstation' as const,
   },
};

test('control waits for the paired bridge, not a child process', async () => {
   const hub = createWorkstationHub();
   const host = workstationKiro(hub);
   const claimed = hub.wait(USER, 2_000);
   const checked = host.control(
      {
         runtimeSessionId: 'berry-workstation-control-session-0001',
         operation: 'availability',
         runtimeId: 'kiro',
         credential: null,
      },
      USER
   );
   const job = await claimed;
   assert.equal(job?.kind, 'control');
   if (job?.kind !== 'control') return;
   hub.completeControl(job.id, AVAILABILITY);
   const response = await checked;
   assert.equal(response.ok, true);
   if (!response.ok) return;
   assert.equal(response.availability?.principalIsolation, 'workstation');
});

test('a workstation task calls tools on the laptop URL, not docker.internal', async () => {
   const hub = createWorkstationHub();
   const host = workstationKiro(hub, { apiUrl: 'http://127.0.0.1:4000' });
   const claimed = hub.wait(USER, 2_000);
   const consume = (async () => {
      for await (const _event of host.invoke(
         {
            runId: 'run-1',
            kind: 'agent',
            berry: { apiUrl: 'http://host.docker.internal:4000', token: 't' },
         } as TaskEnvelope,
         USER,
         new AbortController().signal
      )) {
         // Drain.
      }
   })();
   const job = await claimed;
   assert.equal(job?.kind, 'invoke');
   if (job?.kind !== 'invoke') return;
   assert.equal(job.envelope.berry?.apiUrl, 'http://127.0.0.1:4000');
   hub.pushEvents(job.id, [
      { type: 'task.completed', result: { text: 'ok', truncated: false, delivery: null } },
   ]);
   await consume;
});

test('a task keeps the envelope callback the remote Berry published', async () => {
   const hub = createWorkstationHub();
   const host = workstationKiro(hub);
   const claimed = hub.wait(USER, 2_000);
   const seen: string[] = [];
   const consume = (async () => {
      for await (const event of host.invoke(
         {
            runId: 'run-1',
            kind: 'agent',
            berry: { apiUrl: 'https://berry.example', token: 't' },
         } as TaskEnvelope,
         USER,
         new AbortController().signal
      )) {
         if (event.type === 'task.completed') seen.push(event.result.text);
      }
   })();
   const job = await claimed;
   assert.equal(job?.kind, 'invoke');
   if (job?.kind !== 'invoke') return;
   assert.equal(job.envelope.berry?.apiUrl, 'https://berry.example');
   hub.pushEvents(job.id, [
      { type: 'task.completed', result: { text: job.envelope.berry?.apiUrl ?? '', truncated: false, delivery: null } },
   ]);
   await consume;
   assert.deepEqual(seen, ['https://berry.example']);
});

test('control fails immediately when no bridge is waiting', async () => {
   const hub = createWorkstationHub();
   const host = workstationKiro(hub);
   await assert.rejects(
      () =>
         host.control(
            {
               runtimeSessionId: 'berry-workstation-control-session-0001',
               operation: 'availability',
               runtimeId: 'kiro',
               credential: null,
            },
            USER
         ),
      RuntimeUnavailable
   );
});
