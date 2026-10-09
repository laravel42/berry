import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskEnvelope } from './envelope.ts';
import { workstationKiro } from './workstation-kiro.ts';

const SCRIPT = `
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
   const body = JSON.parse(raw);
   if (body.control) {
      process.stdout.write(JSON.stringify({
         ok: true,
         availability: {
            available: true,
            version: 'kiro-cli 3',
            reason: null,
            protocolVersion: 1,
            principalIsolation: 'workstation',
         },
      }) + '\\n');
      return;
   }
   if (String(JSON.stringify(body)).includes('ksk_')) process.stderr.write('saw a key');
   process.stdout.write(JSON.stringify({
      type: 'task.completed',
      result: { text: 'done', truncated: false, delivery: null },
   }) + '\\n');
});
`;

test('control and a task stay on the workstation process', async () => {
   const host = workstationKiro({ command: process.execPath, args: ['-e', SCRIPT] });
   const checked = await host.control({
      runtimeSessionId: 'berry-workstation-control-session-0001',
      operation: 'availability',
      runtimeId: 'kiro',
      credential: null,
   });
   assert.equal(checked.ok, true);
   if (!checked.ok) return;
   assert.equal(checked.availability?.principalIsolation, 'workstation');

   const events = [];
   for await (const event of host.invoke({ runId: 'run-1', kind: 'agent' } as TaskEnvelope, new AbortController().signal)) {
      events.push(event);
   }
   assert.deepEqual(events.map((event) => event.type), ['task.completed']);
});
