import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { derivedGoalStatus } from './goal-status.ts';

describe('derived goal status', () => {
   test('a goal with nothing in it, or only waiting tasks, is planned', () => {
      assert.equal(derivedGoalStatus({ total: 0, waiting: 0, working: 0, blocked: 0, finished: 0 }), 'planned');
      assert.equal(derivedGoalStatus({ total: 3, waiting: 2, working: 0, blocked: 1, finished: 0 }), 'planned');
   });

   test('work underway, or some of it finished, is active even when another task is blocked', () => {
      assert.equal(derivedGoalStatus({ total: 2, waiting: 0, working: 1, blocked: 1, finished: 0 }), 'active');
      assert.equal(derivedGoalStatus({ total: 3, waiting: 1, working: 1, blocked: 0, finished: 1 }), 'active');
   });

   test('blocked with nothing queued or in progress stays blocked, including when some tasks are already done', () => {
      assert.equal(derivedGoalStatus({ total: 2, waiting: 0, working: 0, blocked: 1, finished: 1 }), 'blocked');
   });

   test('every task done or cancelled completes the goal', () => {
      assert.equal(derivedGoalStatus({ total: 2, waiting: 0, working: 0, blocked: 0, finished: 2 }), 'completed');
   });
});
