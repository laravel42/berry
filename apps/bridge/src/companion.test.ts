import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loop } from './companion.ts';

const TOKEN = 'berry_ws_test';

test('the companion claims a control job and posts the result', async () => {
   const calls: Array<{ path: string; method: string; body: string | undefined }> = [];
   let jobs = 0;
   const stop = new AbortController();
   const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const path = url.replace('https://berry.example', '');
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : undefined;
      calls.push({ path, method, body });
      if (path.startsWith('/api/v1/workstation-bridge/heartbeat')) {
         return new Response(null, { status: 204 });
      }
      if (path.startsWith('/api/v1/workstation-bridge/jobs?')) {
         jobs += 1;
         if (jobs > 1) {
            stop.abort();
            return new Response(null, { status: 204 });
         }
         return Response.json({
            id: '11111111-1111-1111-1111-111111111111',
            kind: 'control',
            request: {
               runtimeSessionId: 'berry-workstation-control-session-0001',
               operation: 'availability',
               runtimeId: 'kiro',
               credential: null,
            },
         });
      }
      if (path.endsWith('/result')) {
         return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
   };

   await loop({
      url: 'https://berry.example',
      token: TOKEN,
      fetch: fetchImpl,
      sleep: async () => stop.abort(),
      signal: stop.signal,
      control: async () => ({
         ok: true,
         availability: {
            available: true,
            version: 'test',
            reason: null,
            protocolVersion: 1,
            principalIsolation: 'workstation',
         },
      }),
      invoke: async () => {
         throw new Error('invoke should not run');
      },
   });

   const posted = calls.find((call) => call.path.endsWith('/result'));
   assert.ok(posted);
   assert.equal(posted.method, 'POST');
   assert.match(posted.body ?? '', /"ok":true/);
});

const CONTROL = {
   runtimeSessionId: 'berry-workstation-control-session-0001',
   operation: 'availability' as const,
   runtimeId: 'kiro' as const,
   credential: null,
};

test('the companion posts a burst of task events in one request', async () => {
   const eventBodies: string[] = [];
   let jobs = 0;
   const stop = new AbortController();
   const fetchImpl: typeof fetch = async (input, init) => {
      const path = String(input).replace('https://berry.example', '');
      const body = typeof init?.body === 'string' ? init.body : undefined;
      if (path.startsWith('/api/v1/workstation-bridge/heartbeat')) {
         return new Response(null, { status: 204 });
      }
      if (path.startsWith('/api/v1/workstation-bridge/jobs?')) {
         jobs += 1;
         if (jobs > 1) {
            stop.abort();
            return new Response(null, { status: 204 });
         }
         return Response.json({
            id: '22222222-2222-2222-2222-222222222222',
            kind: 'invoke',
            envelope: { runId: 'run-1' },
         });
      }
      if (path.endsWith('/events')) {
         if (body) eventBodies.push(body);
         return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
   };

   await loop({
      url: 'https://berry.example',
      token: TOKEN,
      fetch: fetchImpl,
      sleep: async () => stop.abort(),
      signal: stop.signal,
      control: async () => {
         throw new Error('control should not run');
      },
      invoke: async (_envelope, emit) => {
         emit({ type: 'task.started' });
         emit({
            type: 'task.message',
            message: { kind: 'output', channel: 'assistant', text: 'hi' },
         });
         emit({
            type: 'task.completed',
            result: { text: 'done', truncated: false, delivery: null },
         });
      },
   });

   assert.equal(eventBodies.length, 1);
   const posted = JSON.parse(eventBodies[0] ?? '{}') as { events: Array<{ type: string }> };
   assert.deepEqual(
      posted.events.map((event) => event.type),
      ['task.started', 'task.message', 'task.completed']
   );
});

test('the companion claims the next job while a task is still running', async () => {
   let polls = 0;
   let sawSecondPoll = (): void => {};
   const secondPoll = new Promise<void>((resolve) => {
      sawSecondPoll = resolve;
   });
   let finishTask = (): void => {};
   const running = new Promise<void>((resolve) => {
      finishTask = resolve;
   });
   const stop = new AbortController();
   const fetchImpl: typeof fetch = async (input, init) => {
      const path = String(input).replace('https://berry.example', '');
      if (path.startsWith('/api/v1/workstation-bridge/heartbeat')) {
         return new Response(null, { status: 204 });
      }
      if (path.startsWith('/api/v1/workstation-bridge/jobs?')) {
         polls += 1;
         if (polls === 1) {
            return Response.json({
               id: '33333333-3333-3333-3333-333333333333',
               kind: 'invoke',
               envelope: { runId: 'run-1' },
            });
         }
         if (polls === 2) {
            sawSecondPoll();
            return Response.json({
               id: '44444444-4444-4444-4444-444444444444',
               kind: 'control',
               request: CONTROL,
            });
         }
         stop.abort();
         return new Response(null, { status: 204 });
      }
      if (path.endsWith('/events') || path.endsWith('/result')) {
         return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
   };

   const done = loop({
      url: 'https://berry.example',
      token: TOKEN,
      fetch: fetchImpl,
      sleep: async () => stop.abort(),
      signal: stop.signal,
      control: async () => ({ ok: true }),
      invoke: async (_envelope, emit) => {
         emit({ type: 'task.started' });
         await running;
         emit({
            type: 'task.completed',
            result: { text: 'done', truncated: false, delivery: null },
         });
      },
   });

   await secondPoll;
   assert.ok(polls >= 2, 'the jobs poll must continue while invoke is in progress');
   finishTask();
   await done;
});
