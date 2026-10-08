import assert from 'node:assert/strict';
import { test } from 'node:test';
import { followRunEvents } from './event-stream.ts';

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
