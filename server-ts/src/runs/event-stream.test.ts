import assert from 'node:assert/strict';
import { test } from 'node:test';
import { followRunEvents, wakeRunEventStream } from './event-stream.ts';

test('the first read of a run stream says when the backlog is in hand', async () => {
   const chunks: string[] = [];
   const encoder = new TextDecoder();
   let stopped = false;
   const controller = {
      enqueue(bytes: Uint8Array) {
         const text = encoder.decode(bytes);
         chunks.push(text);
         // The client leaving once it has the marker, so the pump does not sit
         // on its poll.
         if (text.includes(': ready')) throw new Error('hung up');
      },
      close() {
         stopped = true;
      },
   };
   await followRunEvents({
      controller: controller as never,
      runs: { events: async () => [] },
      runId: 'run-1',
      after: null,
      signal: new AbortController().signal,
   });
   assert.match(chunks.join(''), /retry: 3000/);
   assert.match(chunks.join(''), /: ready/);
   assert.equal(stopped, false);
});

test('a written run event wakes the stream without waiting out the poll', async () => {
   const chunks: string[] = [];
   let page = 0;
   const pages = [
      [],
      [
         {
            id: 'e1',
            type: 'run.output.delta',
            occurredAt: '2026-10-14T00:00:00.000Z',
            boardId: 'b',
            issueId: 'i',
            runId: 'run-wake',
            sequence: 1,
            payload: { text: 'hi' },
         },
      ],
      [
         {
            id: 'e2',
            type: 'run.completed',
            occurredAt: '2026-10-14T00:00:01.000Z',
            boardId: 'b',
            issueId: 'i',
            runId: 'run-wake',
            sequence: 2,
            payload: {},
         },
      ],
   ];
   const controller = {
      enqueue(bytes: Uint8Array) {
         chunks.push(new TextDecoder().decode(bytes));
      },
      close() {
         return undefined;
      },
   };
   const done = followRunEvents({
      controller: controller as never,
      runs: {
         events: async () => pages[Math.min(page++, pages.length - 1)] ?? [],
      },
      runId: 'run-wake',
      after: null,
      signal: new AbortController().signal,
   });
   await new Promise<void>((resolve) => setImmediate(resolve));
   wakeRunEventStream('run-wake');
   await new Promise<void>((resolve) => setImmediate(resolve));
   wakeRunEventStream('run-wake');
   await done;
   assert.match(chunks.join(''), /run.output.delta/);
   assert.match(chunks.join(''), /run.completed/);
});
