import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WORKSPACE_TOPICS } from './replay.ts';

test('every cycle fact reaches the workspace stream', () => {
   // `CycleRepository` writes these with a null board, so only the workspace
   // replay can carry them; a topic missing here is written and never arrives.
   for (const topic of ['cycle.created', 'cycle.updated', 'cycle.archived']) {
      assert.ok((WORKSPACE_TOPICS as readonly string[]).includes(topic), topic);
   }
});
