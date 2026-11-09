import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isActive, isRetryable, loopRunState, type RunStateFacts } from './run-state.ts';

const base: RunStateFacts = { firing: 'enqueued', task: 'queued', issueStatus: 'todo', timedOut: false };

describe('loop run state', () => {
   test('firing outcomes that never reached an agent run', () => {
      assert.equal(loopRunState({ ...base, firing: 'skipped', task: null }), 'skipped');
      assert.equal(loopRunState({ ...base, firing: 'failed', task: null }), 'failed');
      assert.equal(loopRunState({ ...base, firing: 'pending', task: null }), 'queued');
   });

   test('follows the agent run the ledger owns', () => {
      assert.equal(loopRunState({ ...base, task: 'queued' }), 'queued');
      assert.equal(loopRunState({ ...base, task: 'running' }), 'running');
      assert.equal(loopRunState({ ...base, task: 'failed' }), 'failed');
      assert.equal(loopRunState({ ...base, task: 'cancelled' }), 'canceled');
   });

   test('a finished run whose task waits in review is waiting for approval', () => {
      assert.equal(loopRunState({ ...base, task: 'succeeded', issueStatus: 'in_review' }), 'waiting_for_approval');
      assert.equal(loopRunState({ ...base, task: 'succeeded', issueStatus: 'done' }), 'succeeded');
   });

   test('a cancel Berry made for the time limit is a timeout', () => {
      assert.equal(loopRunState({ ...base, task: 'cancelled', timedOut: true }), 'timed_out');
      // Not a cancellation: the flag only matters once the run was cancelled.
      assert.equal(loopRunState({ ...base, task: 'succeeded', issueStatus: 'done', timedOut: true }), 'succeeded');
   });

   test('an unknown ledger status reads as still going', () => {
      assert.equal(loopRunState({ ...base, task: 'paused-by-future-feature' }), 'running');
   });

   test('only runs that did not do their work are retryable; only live ones are active', () => {
      assert.deepEqual(
         (['failed', 'canceled', 'timed_out', 'succeeded', 'waiting_for_approval', 'running', 'queued', 'skipped'] as const).filter(isRetryable),
         ['failed', 'canceled', 'timed_out']
      );
      assert.equal(isActive('queued'), true);
      assert.equal(isActive('running'), true);
      assert.equal(isActive('waiting_for_approval'), false);
   });
});
