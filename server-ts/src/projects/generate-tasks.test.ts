import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorAssistUnavailable } from '../editor/assist.ts';
import { normalizeProposedTasks, ProjectMilestoneTaskGenerator } from './generate-tasks.ts';

const milestones = [
   { id: '11111111-1111-4111-8111-111111111201', title: 'Launch', targetDate: '2026-12-01' },
   { id: '11111111-1111-4111-8111-111111111202', title: 'Grow', targetDate: null },
] as const;

const agents = [
   {
      id: '11111111-1111-4111-8111-111111111301',
      name: 'Growth Marketer',
      roleKey: 'growth-marketer',
      mission: 'Improve acquisition',
   },
   {
      id: '11111111-1111-4111-8111-111111111302',
      name: 'Software Engineer',
      roleKey: 'software-engineer',
      mission: 'Build the product',
   },
] as const;

test('normalizeProposedTasks keeps known milestones and agents', () => {
   assert.deepEqual(
      normalizeProposedTasks(
         [
            {
               milestoneId: milestones[0].id,
               title: ' Ship pricing page ',
               description: 'Published and linked.',
               priority: 'high',
               agentId: agents[1].id,
            },
            {
               milestoneId: '00000000-0000-4000-8000-000000000099',
               title: 'Unknown milestone',
               description: '',
               priority: 'medium',
               agentId: agents[0].id,
            },
            {
               milestoneId: milestones[0].id,
               title: '',
               description: 'blank title',
               priority: 'medium',
            },
            {
               milestoneId: milestones[1].id,
               title: 'First cohort outreach',
               description: null,
               priority: 'WEIRD',
               agentId: 'not-a-uuid',
            },
            {
               milestoneId: milestones[0].id,
               title: 'Ship pricing page',
               description: 'duplicate',
               priority: 'low',
               agentId: agents[0].id,
            },
            {
               milestoneId: milestones[1].id,
               title: 'Paid pilot',
               description: '',
               priority: 'medium',
               agentId: '00000000-0000-4000-8000-000000000088',
            },
         ],
         milestones,
         agents
      ),
      [
         {
            milestoneId: milestones[0].id,
            title: 'Ship pricing page',
            description: 'Published and linked.',
            priority: 'high',
            agentId: agents[1].id,
         },
         {
            milestoneId: milestones[1].id,
            title: 'First cohort outreach',
            description: null,
            priority: 'medium',
            agentId: null,
         },
         {
            milestoneId: milestones[1].id,
            title: 'Paid pilot',
            description: null,
            priority: 'medium',
            agentId: null,
         },
      ]
   );
});

test('normalizeProposedTasks caps eight tasks per milestone', () => {
   const many = Array.from({ length: 10 }, (_, index) => ({
      milestoneId: milestones[0].id,
      title: `Task ${index + 1}`,
      description: '',
      priority: 'medium' as const,
      agentId: agents[0].id,
   }));
   const out = normalizeProposedTasks(many, milestones, agents);
   assert.equal(out.length, 8);
   assert.equal(out[0]?.title, 'Task 1');
   assert.equal(out[0]?.agentId, agents[0].id);
   assert.equal(out[7]?.title, 'Task 8');
});

type Call = { user: string; system: string };

/** A generator whose model answers each call with `answer(target id, call)`. */
function generatorWith(answer: (targetId: string, call: Call) => Promise<unknown[]>) {
   const calls: Call[] = [];
   let inFlight = 0;
   let peak = 0;
   const generator = new ProjectMilestoneTaskGenerator({
      defaultModel: 'test-model',
      skills: { byNames: async () => [] },
      loadAgents: async () => [...agents],
      today: () => '2026-11-13',
      completion: {
         structured: (async (input: { user: string; system: string }) => {
            calls.push({ user: input.user, system: input.system });
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            try {
               await new Promise((resolve) => setTimeout(resolve, 5));
               const targetId = /Target milestone[^\n]*\n([0-9a-f-]{36}):/.exec(input.user)?.[1] ?? '';
               return { value: { tasks: await answer(targetId, input) } };
            } finally {
               inFlight -= 1;
            }
         }) as never,
      },
   });
   return { generator, calls, peak: () => peak };
}

const propose = (generator: ProjectMilestoneTaskGenerator, list: readonly { id: string; title: string; targetDate: string | null }[]) =>
   generator.propose({ workspaceId: 'w', projectName: 'Site', description: 'Build the site.', milestones: list });

test('every milestone gets its own call, and each answer counts only for its target', async () => {
   const { generator, calls } = generatorWith(async (targetId) => [
      { milestoneId: targetId, title: `First for ${targetId.slice(-3)}` },
      { milestoneId: targetId, title: `Second for ${targetId.slice(-3)}` },
      // Work for another milestone is that milestone's call to plan.
      { milestoneId: milestones.find((m) => m.id !== targetId)!.id, title: 'Stray' },
   ]);
   const tasks = await propose(generator, milestones);
   assert.equal(calls.length, 2);
   for (const milestone of milestones) {
      assert.ok(calls.some((call) => call.user.includes(`Target milestone (plan tasks for this one only):\n${milestone.id}`)));
   }
   // Every call still sees the whole list as context.
   for (const call of calls) for (const milestone of milestones) assert.ok(call.user.includes(milestone.id));
   assert.deepEqual(
      tasks.map((task) => [task.milestoneId, task.title]),
      [
         [milestones[0].id, 'First for 201'],
         [milestones[0].id, 'Second for 201'],
         [milestones[1].id, 'First for 202'],
         [milestones[1].id, 'Second for 202'],
      ]
   );
});

test('a milestone whose call fails gets no tasks; the others are kept', async () => {
   const { generator } = generatorWith(async (targetId) => {
      if (targetId === milestones[0].id) throw new Error('model refused');
      return [{ milestoneId: targetId, title: 'Kept' }];
   });
   const tasks = await propose(generator, milestones);
   assert.deepEqual(tasks.map((task) => task.milestoneId), [milestones[1].id]);
});

test('when every call fails, the reason is reported', async () => {
   const { generator } = generatorWith(async () => {
      throw new Error('model refused');
   });
   await assert.rejects(propose(generator, milestones), (error: unknown) => {
      assert.ok(error instanceof EditorAssistUnavailable);
      assert.match(error.message, /model refused/);
      return true;
   });
});

test('at most four milestone calls are in flight at once', async () => {
   const many = Array.from({ length: 10 }, (_, index) => ({
      id: `11111111-1111-4111-8111-1111111114${String(index).padStart(2, '0')}`,
      title: `Stage ${index}`,
      targetDate: null,
   }));
   const { generator, calls, peak } = generatorWith(async (targetId) => [{ milestoneId: targetId, title: 'One' }]);
   const tasks = await propose(generator, many);
   assert.equal(calls.length, 10);
   assert.equal(tasks.length, 10);
   assert.ok(peak() <= 4, `peak ${peak()}`);
});
