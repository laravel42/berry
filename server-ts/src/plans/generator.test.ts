import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlanGenerator, PlannerUnavailable, repairPrompt } from './generator.ts';
import type { Plan } from './schema.ts';
import type { Sql } from '../db/pool.ts';
import { CompletionFailed, CompletionInvalid, type RuntimeCompletion } from '../runtime/completion.ts';

/**
 * The pipeline: generate, validate, repair, critic.
 *
 * The model is scripted, which is the only way to test the interesting part.
 * A real model produces a valid plan most of the time, so the repair loop —
 * the branch that decides whether a bad plan is fixed, given up on, or made
 * worse — would almost never run under a live check.
 *
 * `model_role_agents` is faked too: which model plays which role is an
 * operator's setting, not behaviour.
 */

/** Every role resolves to one model; the table is not what is under test. */
const NO_ROLES = (() => Promise.resolve([])) as unknown as Sql;

/** Answers each model call in order, and records what it was asked. */
function scripted(answers: unknown[]) {
   const prompts: Array<{ system: string; user: string; timeoutMs: number | undefined }> = [];
   let index = 0;
   const completion = {
      async structured(input: { system: string; user: string; timeoutMs?: number }) {
         prompts.push({ system: input.system, user: input.user, timeoutMs: input.timeoutMs });
         const value = answers[index++] ?? {};
         return { value, text: JSON.stringify(value), inputTokens: 10, outputTokens: 20, durationMs: 1 };
      },
   } as unknown as Pick<RuntimeCompletion, 'structured'>;
   return { completion, prompts, calls: () => index };
}

function generator(answers: unknown[], options: Record<string, unknown> = {}) {
   const script = scripted(answers);
   return {
      script,
      planner: new PlanGenerator({
         sql: NO_ROLES,
                  defaultModel: 'test/model',
         completion: script.completion,
         ...options,
      }),
   };
}

const GOOD = {
   goal: { tempId: 'g1', title: 'Ship it' },
   issues: [{ tempId: 't1', title: 'Do the work', changesRepository: true }],
};
/** `t1` waits on a task that is not in the plan: the validator refuses it. */
const BROKEN = {
   goal: { tempId: 'g1', title: 'Ship it' },
   issues: [{ tempId: 't1', title: 'Do the work', changesRepository: true, dependsOn: ['ghost'] }],
};
const ACCEPT = { verdict: 'accept', problems: [] };

test('a good plan goes straight to the critic', async () => {
   const { planner, script } = generator([GOOD, ACCEPT]);
   const result = await planner.generate({ workspaceId: 'w', prompt: 'ship it' });

   assert.equal(result.validation.status, 'valid');
   assert.equal(result.critique?.verdict, 'accept');
   assert.deepEqual(
      result.stages.map((stage) => stage.stage),
      ['generate', 'critic']
   );
   assert.equal(script.calls(), 2);
});

test('every call gets the planner budget: five minutes unless configured', async () => {
   const standard = generator([GOOD, ACCEPT]);
   await standard.planner.generate({ workspaceId: 'w', prompt: 'ship it' });
   assert.deepEqual(standard.script.prompts.map((prompt) => prompt.timeoutMs), [300_000, 300_000]);
   const configured = generator([GOOD, ACCEPT], { timeoutMs: 30_000 });
   await configured.planner.generate({ workspaceId: 'w', prompt: 'ship it' });
   assert.deepEqual(configured.script.prompts.map((prompt) => prompt.timeoutMs), [30_000, 30_000]);
});

test('the plan records the model that answered, not the one asked for', async () => {
   const answers = [GOOD, ACCEPT];
   let index = 0;
   const completion = {
      async structured() {
         const value = answers[index++] ?? {};
         return { value, text: '', inputTokens: 1, outputTokens: 1, durationMs: 1, model: 'anthropic/claude-sonnet-5' };
      },
   } as unknown as Pick<RuntimeCompletion, 'structured'>;
   const planner = new PlanGenerator({ sql: NO_ROLES, defaultModel: 'us.anthropic.claude-haiku', completion });
   const result = await planner.generate({ workspaceId: 'w', prompt: 'ship it' });
   assert.deepEqual([result.provider, result.model], ['kilo', 'anthropic/claude-sonnet-5']);
   assert.ok(result.stages.every((stage) => stage.model === 'anthropic/claude-sonnet-5'));

   // Nothing reported: the model asked for.
   const { planner: plain } = generator([GOOD, ACCEPT]);
   assert.equal((await plain.generate({ workspaceId: 'w', prompt: 'ship it' })).model, 'test/model');
});

test('a broken plan is sent back with its errors, and fixed', async () => {
   const { planner, script } = generator([BROKEN, GOOD, ACCEPT]);
   const result = await planner.generate({ workspaceId: 'w', prompt: 'ship it' });

   assert.equal(result.validation.status, 'valid');
   assert.equal(result.exhausted, false);
   assert.deepEqual(
      result.stages.map((stage) => stage.stage),
      ['generate', 'repair', 'critic']
   );
   // The repair prompt carries the problems, not just the document — a model
   // asked to "fix this" with no errors named fixes whatever it feels like.
   // Named as a sentence about the task, not as a JSON row of path/code/message.
   assert.match(script.prompts[1]!.user, /unknown_reference/);
   assert.match(script.prompts[1]!.user, /ghost/);
   assert.match(script.prompts[1]!.user, /t1 \("Do the work"\)/);
   assert.doesNotMatch(script.prompts[1]!.user, /"path":/);
});

test('repairs are bounded, and the last document is kept', async () => {
   // A model that cannot fix its own dependency graph in two attempts will
   // not fix it in ten, and each attempt is paid for. The plan is still
   // returned: named errors are something a person can fix, and throwing it
   // away would leave them with the prompt and nothing else.
   const { planner, script } = generator([BROKEN, BROKEN, BROKEN, BROKEN], { maxRepairs: 2 });
   const result = await planner.generate({ workspaceId: 'w', prompt: 'ship it' });

   assert.equal(result.validation.status, 'invalid');
   assert.equal(result.exhausted, true);
   assert.equal(result.plan.issues.length, 1);
   assert.deepEqual(
      result.stages.map((stage) => stage.stage),
      ['generate', 'repair', 'repair']
   );
   // Three model calls, not four: the critic is never asked about a document
   // that cannot be compiled.
   assert.equal(script.calls(), 3);
});

test('a blocked plan is not sent to repair, because nothing is broken', async () => {
   // A plan waiting on an answer is not a wrong plan, and the repair role
   // would invent the answer rather than ask for it.
   const { planner, script } = generator([
      {
         goal: { tempId: 'g1', title: 'Ship it' },
         issues: [],
         assumptions: [{ id: 'a1', description: 'Which repository?', blocking: true }],
      },
   ]);
   const result = await planner.generate({ workspaceId: 'w', prompt: 'ship it' });

   assert.equal(result.validation.status, 'blocked');
   assert.equal(result.exhausted, false);
   assert.deepEqual(
      result.stages.map((stage) => stage.stage),
      ['generate']
   );
   assert.equal(script.calls(), 1);
});

test('a critic asking for a revision gets one round', async () => {
   const revise = {
      verdict: 'revise',
      problems: [
         { code: 'too_big', path: '/issues/0', message: 'This task is a whole project.', severity: 'error' },
      ],
   };
   const better = {
      goal: { tempId: 'g1', title: 'Ship it' },
      issues: [
         { tempId: 't1', title: 'First half', changesRepository: true },
         { tempId: 't2', title: 'Second half', changesRepository: true, dependsOn: ['t1'] },
      ],
   };
   const { planner, script } = generator([GOOD, revise, better], { maxCriticRounds: 1 });
   const result = await planner.generate({ workspaceId: 'w', prompt: 'ship it' });

   assert.equal(result.plan.issues.length, 2, 'the revision was not taken');
   assert.deepEqual(
      result.stages.map((stage) => stage.stage),
      ['generate', 'critic', 'repair']
   );
   assert.match(script.prompts[2]!.user, /whole project/);
});

test("a revision that breaks the plan is discarded, not accepted", async () => {
   // The plan the critic merely disliked is better than one that cannot be
   // compiled at all.
   const revise = {
      verdict: 'revise',
      problems: [{ code: 'style', path: '/issues/0', message: 'Rename it.', severity: 'warning' }],
   };
   const { planner } = generator([GOOD, revise, BROKEN], { maxCriticRounds: 1 });
   const result = await planner.generate({ workspaceId: 'w', prompt: 'ship it' });

   assert.equal(result.validation.status, 'valid');
   assert.equal(result.plan.issues[0]!.title, 'Do the work');
});

test('the critic is asked once per round, and the rounds are bounded', async () => {
   const revise = { verdict: 'revise', problems: [{ code: 'x', path: '/', message: 'again', severity: 'warning' }] };
   const { planner, script } = generator([GOOD, revise, GOOD, revise, GOOD, revise, GOOD], {
      maxCriticRounds: 2,
   });
   const result = await planner.generate({ workspaceId: 'w', prompt: 'ship it' });

   assert.deepEqual(
      result.stages.map((stage) => stage.stage),
      ['generate', 'critic', 'repair', 'critic', 'repair']
   );
   assert.equal(script.calls(), 5);
   assert.equal(result.validation.status, 'valid');
});

test('an unreadable critique is an accept, not a lost plan', async () => {
   // The document already passed the checks that decide whether it can be
   // compiled. Losing it because a reviewer answered badly is the wrong trade.
   const { planner } = generator([GOOD, 'not json at all']);
   const result = await planner.generate({ workspaceId: 'w', prompt: 'ship it' });
   assert.equal(result.validation.status, 'valid');
   assert.equal(result.critique?.verdict, 'accept');
});

test('every stage is costed, so the pipeline does not look free', async () => {
   const { planner } = generator([BROKEN, GOOD, ACCEPT]);
   const result = await planner.generate({ workspaceId: 'w', prompt: 'ship it' });
   // Three calls at 10 in / 20 out.
   assert.equal(result.usage.inputTokens, 30);
   assert.equal(result.usage.outputTokens, 60);
   assert.equal(result.stages.length, 3);
   for (const stage of result.stages) {
      assert.equal(stage.inputTokens, 10);
      assert.equal(stage.outputTokens, 20);
   }
});

test('the caller is told which stage is running, as it starts', async () => {
   const seen: string[] = [];
   const { planner } = generator([BROKEN, GOOD, ACCEPT]);
   await planner.generate({ workspaceId: 'w', prompt: 'ship it', onStage: (stage) => seen.push(stage) });
   assert.deepEqual(seen, ['generate', 'validate', 'repair', 'critic']);
});

test('a refusal names the stage it happened at', async () => {
   // "The critic timed out" and "the planner was never reachable" are
   // different things to tell someone.
   const throttle = Object.assign(new Error('bedrock test/model failed: ThrottlingException 429'), {
      name: 'ThrottlingException',
      $metadata: { httpStatusCode: 429 },
   });
   const completion = {
      async structured() {
         throw new CompletionFailed({ code: 'MODEL_THROTTLED', message: throttle.message, retryable: true });
      },
   };
   const planner = new PlanGenerator({
      sql: NO_ROLES,
            defaultModel: 'test/model',
      completion,
   });
   await assert.rejects(
      () => planner.generate({ workspaceId: 'w', prompt: 'ship it' }),
      (error: unknown) => {
         assert.ok(error instanceof PlannerUnavailable);
         assert.equal(error.stage, 'generate');
         assert.match(error.message, /429/);
         return true;
      }
   );
});

test('a model that will not answer in the schema names the stage', async () => {
   // The structured answer is enforced by the model now, so a refusal is a
   // typed failure rather than a fence to dig through — and it is reported
   // as the planner's, at the stage it happened.
   const completion = {
      async structured() {
         throw new CompletionInvalid('no shape', 'I would rather write prose.');
      },
   };
   const planner = new PlanGenerator({
      sql: NO_ROLES,
            defaultModel: 'test/model',
      completion,
   });
   await assert.rejects(
      () => planner.generate({ workspaceId: 'w', prompt: 'ship it' }),
      (error: unknown) =>
         error instanceof PlannerUnavailable &&
         error.stage === 'generate' &&
         /did not answer with a plan/.test(error.message)
   );
});

test('a revision that breaks on something small is repaired, and its dependencies kept', async () => {
   // What happened for real: the critic asked for ordering, the revision
   // added it, and one approval pointed past the last task. Discarding the
   // revision threw the dependencies away with it.
   const revise = {
      verdict: 'revise',
      problems: [{ code: 'ordering', path: '/issues', message: 'Nothing waits on the design.', severity: 'error' }],
   };
   const ordered = {
      goal: { tempId: 'g1', title: 'Ship it' },
      issues: [
         { tempId: 't1', title: 'Design it', changesRepository: true },
         { tempId: 't2', title: 'Build it', changesRepository: true, dependsOn: ['t1'] },
      ],
   };
   const offByOne = {
      ...ordered,
      approvals: [{ tempId: 'ap1', title: 'Launch?', reason: 'Public.', target: { kind: 'issue', tempId: 't3' } }],
   };
   const fixed = {
      ...ordered,
      approvals: [{ tempId: 'ap1', title: 'Launch?', reason: 'Public.', target: { kind: 'issue', tempId: 't2' } }],
   };
   const { planner, script } = generator([GOOD, revise, offByOne, fixed], { maxCriticRounds: 1 });
   const result = await planner.generate({ workspaceId: 'w', prompt: 'ship it' });

   assert.equal(result.validation.status, 'valid');
   assert.deepEqual(result.plan.issues[1]!.dependsOn, ['t1']);
   assert.deepEqual(
      result.stages.map((stage) => stage.stage),
      ['generate', 'critic', 'repair', 'repair']
   );
   assert.match(script.prompts[3]!.user, /gates nothing/);
});

test('a critique that could not be applied is reported as given, not as an accept', async () => {
   const revise = {
      verdict: 'revise',
      problems: [{ code: 'too_big', path: '/issues/0', message: 'Split it.', severity: 'error' }],
   };
   const { planner } = generator([GOOD, revise, BROKEN, BROKEN, BROKEN], {
      maxCriticRounds: 1,
      maxRepairs: 2,
   });
   const result = await planner.generate({ workspaceId: 'w', prompt: 'ship it' });

   assert.equal(result.plan.issues[0]!.title, 'Do the work', 'the valid plan is kept');
   assert.equal(result.critique?.verdict, 'revise');
   assert.equal(result.critique?.problems[0]?.message, 'Split it.');
});

test('the same fault is said once, with each task named', () => {
   const plan = {
      version: '1',
      goal: { tempId: 'g', title: 'Ship' },
      milestones: [{ tempId: 'm1', title: 'First' }],
      assumptions: [],
      requiredConnections: [],
      issues: [bare('t1'), bare('t2')],
      approvals: [],
      dependencies: [],
   } satisfies Plan;
   const text = repairPrompt(plan, [
      { path: '/issues/0/title', code: 'required', message: 'Task t1 needs a title.' },
      { path: '/issues/1/title', code: 'required', message: 'Task t2 needs a title.' },
      { path: '/issues/0/milestone', code: 'unknown_milestone', message: 't1 names milestone nothing; this plan has m1.' },
      { path: '/issues/1/milestone', code: 'unknown_milestone', message: 't2 names milestone nothing; this plan has m1.' },
   ]);
   assert.match(text, /These tasks have no title\. Give each one a title:\n- t1\n- t2/);
   assert.match(text, /Milestones in the plan: m1 \("First"\)\.\n- t1 names nothing\n- t2 names nothing/);
   assert.equal((text.match(/needs a title/g) ?? []).length, 0);
   assert.doesNotMatch(text, /"code":/);
});

function bare(tempId: string): Plan['issues'][number] {
   return {
      tempId,
      title: '',
      description: null,
      type: 'issue',
      requiredCapabilities: [],
      changesRepository: null,
      dependsOn: [],
      requiresReview: false,
      requiresApproval: false,
      expectedArtifacts: [],
      milestone: null,
   };
}

test('the repair role is shown the whole plan format, dependencies included', async () => {
   const { planner, script } = generator([BROKEN, GOOD, ACCEPT]);
   await planner.generate({ workspaceId: 'w', prompt: 'ship it' });
   assert.match(script.prompts[1]!.system, /"dependsOn"/);
   assert.match(script.prompts[1]!.system, /target\.tempId/);
});

test('a repair the gateway never answers keeps the draft rather than losing it', async () => {
   // What happened for real: the gateway took the repair and said nothing.
   // Five minutes later the whole generation failed, and a document whose
   // errors were named and fixable was thrown away, leaving a person with the
   // prompt and nothing else. It now ends the way an exhausted repair does.
   let calls = 0;
   const completion = {
      async structured() {
         calls += 1;
         if (calls === 1) return { value: BROKEN, text: '', inputTokens: 10, outputTokens: 20, durationMs: 1 };
         throw new CompletionFailed({
            code: 'COMPLETION_TIMEOUT',
            message: 'the completion did not finish in time',
            retryable: true,
         });
      },
   } as unknown as Pick<RuntimeCompletion, 'structured'>;
   const planner = new PlanGenerator({ sql: NO_ROLES, defaultModel: 'test/model', completion, maxRepairs: 2 });

   const result = await planner.generate({ workspaceId: 'w', prompt: 'ship it' });

   assert.equal(result.validation.status, 'invalid');
   assert.equal(result.exhausted, true);
   assert.equal(result.plan.issues.length, 1, "the planner's document survives");
   // The stage is recorded, so a reader sees where the pipeline stopped.
   const stopped = result.stages.at(-1)!;
   assert.equal(stopped.stage, 'repair');
   assert.equal(stopped.outcome, 'error');
   assert.match(String(stopped.detail.message), /did not finish in time/);
   // Not asked twice: the second repair is the same call into the same silence.
   assert.equal(calls, 2);
});

test('a critic revision the gateway never answers keeps the valid plan', async () => {
   // Worse than losing a broken draft: this one passed every check, and only
   // the critic's polish was out of reach.
   const revise = {
      verdict: 'revise',
      problems: [{ code: 'ordering', path: '/issues', message: 'Nothing waits on the design.', severity: 'error' }],
   };
   let calls = 0;
   const completion = {
      async structured() {
         calls += 1;
         if (calls === 1) return { value: GOOD, text: '', inputTokens: 10, outputTokens: 20, durationMs: 1 };
         if (calls === 2) return { value: revise, text: '', inputTokens: 10, outputTokens: 20, durationMs: 1 };
         throw new CompletionFailed({ code: 'COMPLETION_TIMEOUT', message: 'the completion did not finish in time', retryable: true });
      },
   } as unknown as Pick<RuntimeCompletion, 'structured'>;
   const planner = new PlanGenerator({ sql: NO_ROLES, defaultModel: 'test/model', completion });

   const result = await planner.generate({ workspaceId: 'w', prompt: 'ship it' });

   assert.equal(result.validation.status, 'valid');
   assert.equal(result.exhausted, false);
   assert.equal(result.plan.issues.length, 1);
   // The verdict stands as given: reporting `accept` would hide the problems.
   assert.equal(result.critique?.verdict, 'revise');
});
