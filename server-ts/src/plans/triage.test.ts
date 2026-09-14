import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { z } from 'zod';
import { PlanTriage, TriageUnavailable } from './triage.ts';

/**
 * What the orchestrator is allowed to decide, and what happens to the rest.
 *
 * The model is faked: what is under test is which of its answers are believed,
 * and which tasks are started once they are.
 */

interface Fake {
   triage: PlanTriage;
   admitted: Array<{ issueId: string; agentId: string; instructions: string }>;
   sent: () => Record<string, unknown>;
}

interface FakeAgent {
   id: string;
   role?: string;
   mission?: string;
}

function fake(options: {
   tasks: Array<{ id: string; status: string; title?: string; description?: string | null }>;
   agents: Array<string | FakeAgent>;
   answer: unknown;
   admitFails?: string;
   begin?: (work: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
}): Fake {
   const admitted: Fake['admitted'] = [];
   let sent: Record<string, unknown> = {};

   const triage = new PlanTriage({
      // A tagged template that yields no rows: the model falls back to the
      // deployment default, and the assignment UPDATE writes into nothing.
      sql: Object.assign(async () => [], { begin: options.begin }) as never,
      defaultModel: 'test/model',
      completion: {
         async structured(input: { model: string; system: string; user: string; schema: z.ZodType }) {
            sent = { model: input.model, system: input.system, user: input.user };
            // Parsed the way the real completion parses it, so an answer the
            // schema refuses is refused here too.
            const value = input.schema.parse(options.answer);
            return { value, text: JSON.stringify(value), inputTokens: 0, outputTokens: 0, durationMs: 1 };
         },
      } as never,
   });

   // The database halves are replaced: this test is about the decision, and a
   // real schema would only restate what the fixtures already say.
   (triage as unknown as { tasks: unknown }).tasks = async () =>
      options.tasks.map((task) => ({
         id: task.id,
         number: 1,
         title: task.title ?? task.id,
         description: task.description ?? null,
         status: task.status,
         capabilities: [],
      }));
   (triage as unknown as { roster: unknown }).roster = async () =>
      options.agents.map((agent) => {
         const normalized: FakeAgent = typeof agent === 'string' ? { id: agent } : agent;
         return {
            id: normalized.id,
            name: normalized.id,
            description: null,
            capabilities: [],
            role: normalized.role ?? null,
            mission: normalized.mission ?? null,
            autonomy: null,
         };
      });

   return {
      triage,
      admitted,
      sent: () => sent,
   };
}

async function run(f: Fake, admitFails?: string) {
   return f.triage.triage({
      planId: 'p1',
      workspaceId: 'w1',
      admit: async (task) => {
         if (admitFails && task.issueId === admitFails) throw new Error('busy');
         f.admitted.push(task);
      },
   });
}

describe('routing a compiled plan', () => {
   test('assigns what the orchestrator decided and starts what can run', async () => {
      const f = fake({
         tasks: [
            { id: 't1', status: 'todo' },
            { id: 't2', status: 'blocked' },
         ],
         agents: ['a1'],
         answer: { assignments: [{ taskId: 't1', agentId: 'a1' }, { taskId: 't2', agentId: 'a1' }] },
      });

      const result = await run(f);

      assert.equal(result.assigned, 2);
      // Blocked work waits on another task, so starting it would put an agent
      // on something whose input does not exist yet.
      assert.equal(result.started, 1);
      assert.deepEqual(f.admitted.map((a) => a.issueId), ['t1']);
   });

   test('an agent that is not on the roster is dropped, not written', async () => {
      const f = fake({
         tasks: [{ id: 't1', status: 'todo' }],
         agents: ['a1'],
         answer: { assignments: [{ taskId: 't1', agentId: 'someone-else' }] },
      });

      const result = await run(f);

      assert.equal(result.assigned, 0);
      assert.deepEqual(result.unassigned, ['t1']);
   });

   test('a task outside this plan is dropped', async () => {
      const f = fake({
         tasks: [{ id: 't1', status: 'todo' }],
         agents: ['a1'],
         answer: { assignments: [{ taskId: 'someone-elses-task', agentId: 'a1' }] },
      });

      assert.equal((await run(f)).assigned, 0);
   });

   test('one task failing to start does not strand the others', async () => {
      const f = fake({
         tasks: [
            { id: 't1', status: 'todo' },
            { id: 't2', status: 'todo' },
         ],
         agents: ['a1'],
         answer: { assignments: [{ taskId: 't1', agentId: 'a1' }, { taskId: 't2', agentId: 'a1' }] },
      });

      const result = await run(f, 't1');

      assert.equal(result.assigned, 2);
      assert.equal(result.started, 1);
      assert.deepEqual(f.admitted.map((a) => a.issueId), ['t2']);
   });

   test('a workspace with no agent to take work says so', async () => {
      const f = fake({ tasks: [{ id: 't1', status: 'todo' }], agents: [], answer: {} });

      await assert.rejects(run(f), TriageUnavailable);
   });

   test('nothing to route is not a failure', async () => {
      const f = fake({ tasks: [], agents: ['a1'], answer: {} });

      assert.deepEqual(await run(f), { assigned: 0, started: 0, unassigned: [] });
   });

   test('the orchestrator is shown the task and the roster, and nothing else', async () => {
      const f = fake({
         tasks: [{ id: 't1', status: 'todo', title: 'Ship it', description: 'the details' }],
         agents: [{ id: 'a1', role: 'Principal Software Architect', mission: 'Own the architecture.' }],
         answer: { assignments: [] },
      });

      await run(f);
      const body = f.sent();
      const user = JSON.parse(body.user as string) as {
         agents: Array<{ id: string; role: string | null; mission: string | null }>;
         tasks: Array<{ id: string; title: string }>;
      };

      assert.equal(user.agents.length, 1);
      assert.equal(user.agents[0]!.role, 'Principal Software Architect');
      assert.equal(user.agents[0]!.mission, 'Own the architecture.');
      assert.deepEqual(user.tasks[0]!.id, 't1');
      assert.deepEqual(user.tasks[0]!.title, 'Ship it');
   });

   test('an assignment naming a workflow writes it as issue metadata', async () => {
      // patchMetadata's tagged template is
      //   UPDATE issues SET metadata = (metadata - ${remove}::text[]) || ${q.json(set)}::jsonb ...
      //   WHERE id = ${issueId} AND deleted_at IS NULL RETURNING metadata
      // so the captured values are, in order: [remove, q.json(set), issueId]. `q.json` is stubbed
      // as the identity function, so values[1] is the actual `set` object patchMetadata built.
      const metadataWrites: Array<{ issueId: string; set: unknown }> = [];
      const f = fake({
         tasks: [{ id: 't1', status: 'todo' }],
         agents: ['a1'],
         answer: { assignments: [{ taskId: 't1', agentId: 'a1', workflow: 'frontend-visual-bug' }] },
         begin: async (work) => {
            const tx = async (_strings: TemplateStringsArray, ...values: unknown[]) => {
               const [, set, issueId] = values as [unknown, Record<string, unknown>, string];
               metadataWrites.push({ issueId, set });
               // Echo back what was actually written, not a hardcoded value: a
               // stub that always answers the same thing would pass even if
               // patchMetadata had built the wrong key, value or issue id.
               return [{ metadata: set }];
            };
            (tx as unknown as { json: (value: unknown) => unknown }).json = (value: unknown) => value;
            return work(tx);
         },
      });

      const result = await run(f);

      assert.equal(result.assigned, 1);
      assert.equal(metadataWrites.length, 1);
      assert.equal(metadataWrites[0]!.issueId, 't1');
      assert.deepEqual(metadataWrites[0]!.set, { 'berry.workflow': 'frontend-visual-bug' });
   });

   test('an assignment with no workflow never opens a transaction', async () => {
      let called = false;
      const f = fake({
         tasks: [{ id: 't1', status: 'todo' }],
         agents: ['a1'],
         answer: { assignments: [{ taskId: 't1', agentId: 'a1' }] },
         begin: async () => {
            called = true;
            throw new Error('should not be called');
         },
      });

      const result = await run(f);

      assert.equal(result.assigned, 1);
      assert.equal(called, false);
   });

   test('a workflow key the model invented is dropped, not written', async () => {
      let called = false;
      const f = fake({
         tasks: [{ id: 't1', status: 'todo' }],
         agents: ['a1'],
         answer: { assignments: [{ taskId: 't1', agentId: 'a1', workflow: 'not-a-real-workflow' }] },
         begin: async () => {
            called = true;
            throw new Error('should not be called');
         },
      });

      const result = await run(f);

      assert.equal(result.assigned, 1);
      assert.equal(called, false);
   });
});
