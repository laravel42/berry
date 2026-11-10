import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
   conditionsMatch,
   eventKeysForTopic,
   eventTypeMatches,
   InvalidConditions,
   LOOP_TOPICS,
   parseConditions,
   type EventFacts,
} from './event-triggers.ts';

function facts(overrides: Partial<EventFacts> = {}, issue: Partial<NonNullable<EventFacts['issue']>> = {}): EventFacts {
   return {
      topic: 'issue.created',
      actor: { type: 'user', id: 'u1' },
      issue: {
         id: 'i1',
         projectId: 'p1',
         status: 'todo',
         previousStatus: null,
         priority: 'high',
         labels: ['Bug', 'mobile'],
         assignee: null,
         changedFields: [],
         ...issue,
      },
      projectId: null,
      pullRequestState: null,
      ...overrides,
   };
}

describe('loop event types', () => {
   test('an event type matches only its own topic', () => {
      assert.equal(eventTypeMatches('issue.created', facts()), true);
      assert.equal(eventTypeMatches('issue.completed', facts()), false);
   });

   test('status_changed is issue.updated where the status moved, and nothing else', () => {
      const moved = facts({ topic: 'issue.updated' }, { changedFields: ['status'] });
      const renamed = facts({ topic: 'issue.updated' }, { changedFields: ['title'] });
      assert.equal(eventTypeMatches('issue.status_changed', moved), true);
      assert.equal(eventTypeMatches('issue.status_changed', renamed), false);
      assert.equal(eventTypeMatches('issue.updated', renamed), true);
   });

   test('a topic maps back to every event type that reads it', () => {
      assert.deepEqual(eventKeysForTopic('issue.updated').sort(), ['issue.status_changed', 'issue.updated']);
      assert.ok(LOOP_TOPICS.includes('github.pull_request.updated'));
      // Decisions are not written to the outbox, so no Loop may listen for one.
      assert.ok(!LOOP_TOPICS.includes('approval.approved'));
      assert.ok(!LOOP_TOPICS.includes('approval.rejected'));
   });
});

describe('loop filters', () => {
   test('no rules always match', () => {
      assert.equal(conditionsMatch(parseConditions('issue.created', undefined), facts()), true);
   });

   test('labels match case-insensitively, by any of the values', () => {
      const bug = parseConditions('issue.created', { rules: [{ field: 'label', op: 'in', values: ['bug'] }] });
      assert.equal(conditionsMatch(bug, facts()), true);
      assert.equal(conditionsMatch(bug, facts({}, { labels: ['feature'] })), false);
   });

   test('not_in holds when the fact is absent', () => {
      const notDone = parseConditions('issue.created', { rules: [{ field: 'status', op: 'not_in', values: ['done'] }] });
      assert.equal(conditionsMatch(notDone, facts({}, { status: null })), true);
      assert.equal(conditionsMatch(notDone, facts({}, { status: 'done' })), false);
   });

   test('all requires every rule, any requires one', () => {
      const rules = [
         { field: 'priority', op: 'in', values: ['urgent'] },
         { field: 'project', op: 'in', values: ['p1'] },
      ];
      assert.equal(conditionsMatch(parseConditions('issue.created', { match: 'all', rules }), facts()), false);
      assert.equal(conditionsMatch(parseConditions('issue.created', { match: 'any', rules }), facts()), true);
   });

   test('assignee and actor compare as type:id, and none is a value', () => {
      const unassigned = parseConditions('issue.created', { rules: [{ field: 'assignee', op: 'in', values: ['none'] }] });
      assert.equal(conditionsMatch(unassigned, facts()), true);
      assert.equal(conditionsMatch(unassigned, facts({}, { assignee: { type: 'agent', id: 'a1' } })), false);
      const byAgent = parseConditions('issue.created', { rules: [{ field: 'actorType', op: 'in', values: ['agent'] }] });
      assert.equal(conditionsMatch(byAgent, facts()), false);
   });

   test('a project event without a task matches on its own project', () => {
      const project = parseConditions('project.updated', { rules: [{ field: 'project', op: 'in', values: ['p9'] }] });
      assert.equal(conditionsMatch(project, facts({ topic: 'project.updated', issue: null, projectId: 'p9' })), true);
   });

   test('a filter the event type cannot state is refused, not stored to never match', () => {
      assert.throws(
         () => parseConditions('issue.created', { rules: [{ field: 'pullRequestState', op: 'in', values: ['open'] }] }),
         InvalidConditions
      );
      assert.throws(
         () => parseConditions('project.created', { rules: [{ field: 'label', op: 'in', values: ['bug'] }] }),
         InvalidConditions
      );
      assert.throws(() => parseConditions('issue.created', { rules: [{ field: 'changed', op: 'in', values: ['status'] }] }), InvalidConditions);
   });

   test('more than eight rules, unknown fields and empty values are refused', () => {
      const rule = { field: 'priority', op: 'in', values: ['high'] };
      assert.throws(() => parseConditions('issue.created', { rules: Array(9).fill(rule) }), InvalidConditions);
      assert.throws(() => parseConditions('issue.created', { rules: [{ field: 'body', op: 'in', values: ['x'] }] }), InvalidConditions);
      assert.throws(() => parseConditions('issue.created', { rules: [{ field: 'priority', op: 'in', values: [] }] }), InvalidConditions);
      assert.throws(() => parseConditions('issue.created', { rules: [], extra: true }), InvalidConditions);
   });

   test('duplicate values collapse', () => {
      const parsed = parseConditions('issue.created', { rules: [{ field: 'label', op: 'in', values: ['bug', 'bug'] }] });
      assert.deepEqual(parsed.rules[0]?.values, ['bug']);
   });
});
