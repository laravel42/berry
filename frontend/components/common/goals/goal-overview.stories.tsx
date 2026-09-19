import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { expect } from 'storybook/test';
import { useApprovalsStore } from '@/store/approvals-store';
import { useGoalsStore } from '@/store/goals-store';
import { pendingApproval } from '../../../.storybook/msw-handlers';
import {
   goalActive,
   goalCompleted,
   seedGoalStores,
   seedProjectStores,
   storyIssues,
} from '../projects/stories-fixtures';
import GoalOverview from './goal-overview';

const goalIssues = storyIssues
   .filter((issue) => issue.project?.id === goalActive.projectId)
   .map((issue) => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      status: 'todo',
      linkedAt: '2026-09-02T11:20:00Z',
   }));

const goalPlans = [
   {
      id: 'plan-7',
      status: 'accepted',
      source: 'planner',
      version: 2,
      generationStatus: 'succeeded',
      validationStatus: 'passed',
      compileStatus: 'succeeded',
      createdAt: '2026-09-01T08:40:00Z',
   },
];

/** The four reads the page makes, answered for whichever goal the story shows. */
function goalHandlers(options: { empty?: boolean } = {}) {
   const goals = [goalActive, goalCompleted];
   return [
      http.get('*/api/v1/goals/:id', ({ params }) => {
         const goal = goals.find((candidate) => candidate.id === params.id);
         return goal
            ? HttpResponse.json(goal)
            : HttpResponse.json(
                 { error: { code: 'GOAL_NOT_FOUND', message: 'Goal not found' } },
                 { status: 404 }
              );
      }),
      http.get('*/api/v1/goals/:id/issues', () =>
         HttpResponse.json({ nodes: options.empty ? [] : goalIssues })
      ),
      http.get('*/api/v1/goals/:id/approvals', () => HttpResponse.json({ nodes: [] })),
      http.get('*/api/v1/goals/:id/plans', () =>
         HttpResponse.json({ nodes: options.empty ? [] : goalPlans })
      ),
   ];
}

const meta = {
   component: GoalOverview,
   tags: ['ai-generated', 'needs-work'],
   args: { goalId: goalActive.id },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: ({ msw }) => {
      seedProjectStores({ sessionReady: true });
      seedGoalStores();
      msw.use(...goalHandlers());
   },
   decorators: [
      (Story) => (
         // Task rows are drag sources, as on the board.
         <DndProvider backend={HTML5Backend}>
            <div className="h-[760px] w-[1100px] border">
               <Story />
            </div>
         </DndProvider>
      ),
   ],
} satisfies Meta<typeof GoalOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Tasks from the store, a pending approval and the plan that made the goal. */
export const Active: Story = {
   beforeEach: () => {
      useApprovalsStore.setState({
         approvals: [{ ...pendingApproval, goalId: goalActive.id }],
      });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { name: goalActive.title })).toBeVisible();
      // The plan list arrives from /api/v1/goals/:id/plans.
      await expect(await canvas.findByText('Plan v2')).toBeVisible();
   },
};

export const Completed: Story = { args: { goalId: goalCompleted.id } };

/** A goal whose tasks and plan have gone: the page says it can be archived. */
export const NothingLinked: Story = {
   args: { goalId: goalCompleted.id },
   beforeEach: ({ msw }) => {
      msw.use(...goalHandlers({ empty: true }));
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText(/it can be archived/)).toBeVisible();
   },
};

export const NotFound: Story = {
   args: { goalId: 'goal-missing' },
   beforeEach: () => {
      useGoalsStore.setState({ goals: [] });
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('alert')).toHaveTextContent(
         'The goal could not be found.'
      );
   },
};
