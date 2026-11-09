import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { nextFireTimes } from './cron.ts';
import { draftFromRules, LoopDrafter, nameFrom, normalizeModelDraft, parseEvent, parseSchedule, parseTime } from './draft.ts';

describe('reading a schedule from a sentence', () => {
   const cases: Array<[string, string]> = [
      ['Every weekday at 9 AM, review open bugs and suggest priorities.', '0 9 * * 1-5'],
      ['Every morning, review all active projects', '0 9 * * *'],
      ['Every Friday at 4pm summarize completed work', '0 16 * * 5'],
      ['every monday and thursday at 08:30 check the backlog', '30 8 * * 1,4'],
      ['Every 2 hours look for stale tasks', '0 */2 * * *'],
      ['every 1 minute poll', '*/5 * * * *'],
      ['Weekly, summarize progress', '0 9 * * 1'],
      ['Monthly review of milestones at noon', '0 12 1 * *'],
      ['Daily at 17:45 post a digest', '45 17 * * *'],
   ];
   for (const [sentence, expression] of cases) {
      test(sentence, () => assert.equal(parseSchedule(sentence)?.expression, expression));
   }

   test('no schedule in a sentence about events', () => {
      assert.equal(parseSchedule('When a new bug is reported, triage it'), null);
   });

   test('times', () => {
      assert.deepEqual(parseTime('at 12am'), { hour: 0, minute: 0 });
      assert.deepEqual(parseTime('at 12 pm'), { hour: 12, minute: 0 });
      assert.equal(parseTime('at 25:00'), null);
   });

   test('a schedule a draft proposes is one croner accepts, and it keeps local time across DST', () => {
      const expression = parseSchedule('every weekday at 9am')?.expression ?? '';
      // Europe/Rome leaves summer time on 2026-10-25. 09:00 local stays 09:00
      // local, so the UTC hour moves from 07 to 08.
      const times = nextFireTimes(expression, 'Europe/Rome', new Date('2026-10-22T12:00:00Z'), 3).map((time) => time.toISOString());
      assert.deepEqual(times, ['2026-10-23T07:00:00.000Z', '2026-10-26T08:00:00.000Z', '2026-10-27T08:00:00.000Z']);
   });
});

describe('reading an event from a sentence', () => {
   test('a new bug', () => {
      const event = parseEvent('When a new bug is reported, analyze its severity');
      assert.equal(event?.eventType, 'issue.created');
      assert.deepEqual(event?.conditions.rules, [{ field: 'label', op: 'in', values: ['bug'] }]);
   });

   test('pull requests, failures, blocked work, review', () => {
      assert.equal(parseEvent('When a pull request is opened, review it')?.eventType, 'github.pull_request.updated');
      assert.equal(parseEvent('When an agent run fails, explain why')?.eventType, 'run.failed');
      assert.equal(parseEvent('Whenever a task gets blocked, propose a fix')?.conditions.rules[0]?.values[0], 'blocked');
      assert.equal(parseEvent('When a task moves to review, draft QA checks')?.conditions.rules[0]?.values[0], 'inReview');
   });

   test('no event without a when', () => {
      assert.equal(parseEvent('Summarize the bugs'), null);
   });
});

describe('a rule-based draft', () => {
   test('is never act, and says so when the sentence asks for changes', () => {
      const draft = draftFromRules('When a new bug is reported, assign it to the right engineer');
      assert.equal(draft.accessMode, 'recommend');
      assert.ok(draft.notes.some((note) => note.includes('Recommend mode')));
      assert.equal(draft.source, 'rules');
      assert.equal(draft.roles.at(-1), 'orchestrator');
   });

   test('without a trigger it asks for one', () => {
      const draft = draftFromRules('Look at our docs');
      assert.equal(draft.trigger, null);
      assert.ok(draft.notes.length > 0);
   });

   test('names drop the trigger phrase', () => {
      assert.equal(nameFrom('Every weekday at 9 AM, review open bugs and suggest priorities.'), 'Review open bugs');
      assert.equal(nameFrom('When a new bug is reported, analyze its severity'), 'Analyze its severity');
   });
});

describe('a model draft', () => {
   const fallback = draftFromRules('Every Monday summarize the week');

   test('keeps what validates and replaces what does not with the rules', () => {
      const draft = normalizeModelDraft(
         {
            name: 'Weekly wrap',
            instructions: 'Summarize.',
            trigger: { kind: 'event', cron: null, eventType: 'approval.approved', conditions: null, description: 'x' },
            roles: ['product-lead', 'made-up-role'],
            notes: [],
         },
         fallback
      );
      assert.equal(draft.trigger?.kind, 'cron', 'an event Berry never emits falls back to the rules');
      assert.deepEqual(draft.roles, ['product-lead', 'orchestrator']);
      assert.equal(draft.accessMode, 'recommend');
   });

   test('refuses a schedule that fires every minute', () => {
      const draft = normalizeModelDraft(
         {
            name: 'x',
            instructions: 'y',
            trigger: { kind: 'cron', cron: '* * * * *', eventType: null, conditions: null, description: '' },
            roles: [],
            notes: [],
         },
         fallback
      );
      assert.equal(draft.trigger?.kind === 'cron' ? draft.trigger.expression : '', fallback.trigger?.kind === 'cron' ? fallback.trigger.expression : '');
   });

   test('falls back to the rules when the model cannot be reached', async () => {
      const drafter = new LoopDrafter({
         defaultModel: 'm',
         completion: { structured: async () => Promise.reject(new Error('no runtime')) },
      });
      const draft = await drafter.draft({ workspaceId: 'w', prompt: 'Every Friday summarize', useModel: true });
      assert.equal(draft.source, 'rules');
      assert.ok(draft.notes.some((note) => note.includes('without a model')));
   });

   test('does not call the model when the workspace has none', async () => {
      let called = false;
      const drafter = new LoopDrafter({
         defaultModel: 'm',
         completion: { structured: async () => { called = true; throw new Error('unused'); } },
      });
      await drafter.draft({ workspaceId: 'w', prompt: 'Every Friday summarize', useModel: false });
      assert.equal(called, false);
   });
});
