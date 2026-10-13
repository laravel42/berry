import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMessage } from './prompt.ts';

const base = {
   issueIdentifier: 'L42-7',
   issueTitle: 'Decide the cache TTL',
   issueDescription: 'Pick one.',
   instructions: null,
   repository: null,
} as unknown as Parameters<typeof buildMessage>[0];

test('a 70,000-character description does not push out the instructions, the review or the merge', () => {
   const message = buildMessage({
      ...base,
      repository: 'acme/app',
      issueDescription: `Start of the description.\n${'x'.repeat(70_000)}\nEND_OF_DESCRIPTION`,
      instructions: 'RUN_INSTRUCTION: use the staging cache.',
      reviewFeedback: 'REVIEW_FINDING: the TTL is not documented.',
      related: 'PARENT_CONTEXT: ship the cache.',
      priorWork: 'PRIOR_WORK: measured the hit rate.',
      skills: [{ name: 'SKILL_NAME', description: 'Use it.' }],
      merge: 'MERGE_REQUIREMENT: reconcile src/cache.ts.',
   });
   assert.ok(Buffer.byteLength(message, 'utf8') <= 64 * 1024);
   for (const marker of ['RUN_INSTRUCTION', 'REVIEW_FINDING', 'PARENT_CONTEXT', 'PRIOR_WORK', 'SKILL_NAME', 'MERGE_REQUIREMENT']) {
      assert.match(message, new RegExp(marker), `${marker} survives`);
   }
   // The description is cut inside its fence, and the fence still closes.
   assert.match(message, /Start of the description\./);
   assert.doesNotMatch(message, /END_OF_DESCRIPTION/);
   assert.equal(message.split('<issue_description>').length, 2);
   assert.equal(message.split('</issue_description>').length, 2);
   assert.match(message, /The description was cut to \d+ of \d+ characters\. read_task returns all of it\./);
   // The contracts at the end are all there.
   assert.match(message, /Reporting your result/);
   assert.match(message, /Delivering your work/);
});

test('a description that fits is carried whole, with no note about cutting it', () => {
   const message = buildMessage({ ...base, issueDescription: 'Pick one TTL for the cache.' });
   assert.match(message, /<issue_description>\nPick one TTL for the cache\.\n<\/issue_description>/);
   assert.doesNotMatch(message, /was cut to/);
});

test('every evidence block oversized at once still leaves the requirements and the contracts', () => {
   const huge = (tag: string) => `${tag}_START ${'y'.repeat(80_000)} ${tag}_END`;
   const message = buildMessage({
      ...base,
      repository: 'acme/app',
      issueDescription: huge('DESCRIPTION'),
      comments: [{ author: 'Ada', body: huge('COMMENT'), createdAt: '2026-10-01T10:00:00.000Z' }],
      related: huge('RELATED'),
      priorWork: huge('PRIOR'),
      dependencyHandoffs: huge('HANDOFF'),
      instructions: huge('INSTRUCTIONS'),
      reviewFeedback: huge('REVIEW'),
      merge: 'MERGE_REQUIREMENT: reconcile src/cache.ts.',
   });
   assert.ok(Buffer.byteLength(message, 'utf8') <= 64 * 1024);
   for (const tag of ['issue_description', 'task_comments', 'related_tasks', 'prior_work', 'dependency_handoffs', 'run_instructions', 'review_feedback']) {
      assert.equal(message.split(`<${tag}>`).length, 2, `${tag} opens once`);
      assert.equal(message.split(`</${tag}>`).length, 2, `${tag} closes`);
   }
   assert.match(message, /INSTRUCTIONS_START/);
   assert.match(message, /The run instructions were cut to \d+ of \d+ characters\./);
   assert.match(message, /REVIEW_START/);
   assert.match(message, /The review was cut to \d+ of \d+ characters\./);
   // Earlier work keeps its newest end: that is the attempt the next one follows.
   assert.match(message, /PRIOR_END/);
   assert.doesNotMatch(message, /PRIOR_START/);
   assert.match(message, /Your earlier work on this issue was cut to \d+ of \d+ characters, keeping the newest\./);
   assert.match(message, /MERGE_REQUIREMENT/);
   assert.match(message, /Reporting your result/);
   assert.match(message, /Delivering your work/);
});
