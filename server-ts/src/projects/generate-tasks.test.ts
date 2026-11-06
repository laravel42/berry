import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeProposedTasks } from './generate-tasks.ts';

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
