import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor } from 'storybook/test';
import { orgParams } from '@/components/common/agents/stories-fixtures';
import type { PlanSummary } from '@/lib/plans';
import { projectHealth, projectInbox, seedProjectStores } from '../stories-fixtures';
import { ProjectPlanSection } from './project-plan-section';

function plan(overrides: Partial<PlanSummary> & Pick<PlanSummary, 'id' | 'title'>): PlanSummary {
   return {
      status: 'approved',
      projectId: projectHealth.id,
      projectName: projectHealth.name,
      goalId: null,
      generation: { status: 'succeeded', error: null, stage: 'finalize' },
      validationStatus: 'valid',
      compileStatus: 'succeeded',
      routingStatus: 'succeeded',
      plannedTasks: 5,
      createdTasks: 5,
      finishedTasks: 2,
      autoGate: false,
      archived: false,
      createdAt: '2026-09-10T09:00:00Z',
      updatedAt: '2026-09-18T09:00:00Z',
      ...overrides,
   };
}

let fetchedRejectedOnly = false;

const answer = (plans: PlanSummary[]) =>
   http.get('*/api/v1/plans', () => HttpResponse.json({ nodes: plans }));

const meta = {
   component: ProjectPlanSection,
   tags: ['ai-generated'],
   args: { projectId: projectHealth.id },
   parameters: orgParams,
   beforeEach: ({ msw }) => {
      seedProjectStores();
      msw.use(answer([plan({ id: 'plan-1', title: 'Persist project health and weekly updates' })]));
   },
} satisfies Meta<typeof ProjectPlanSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The project's started plan, with its task progress. */
export const WithOneStartedPlan: Story = {
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('Persist project health and weekly updates')
      ).toBeVisible();
      await expect(canvas.getByText('Plan')).toBeVisible();
      await expect(canvas.getByText('2/5')).toBeVisible();
   },
};

/** More than one live plan: the label pluralizes to "Plans". */
export const WithSeveralPlans: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         answer([
            plan({ id: 'plan-1', title: 'Persist project health and weekly updates' }),
            plan({
               id: 'plan-2',
               title: 'Backfill health for older projects',
               createdTasks: 0,
               finishedTasks: 0,
               plannedTasks: 3,
            }),
         ])
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('3 tasks planned')).toBeVisible();
      await expect(canvas.getByText('Plans')).toBeVisible();
   },
};

/** Rejected and superseded plans stay on the Plans page: the section draws nothing. */
export const NoLivePlansRendersNothing: Story = {
   args: { projectId: projectInbox.id },
   beforeEach: ({ msw }) => {
      fetchedRejectedOnly = false;
      msw.use(
         http.get('*/api/v1/plans', () => {
            fetchedRejectedOnly = true;
            return HttpResponse.json({
               nodes: [
                  plan({
                     id: 'plan-3',
                     title: 'An earlier rejected plan',
                     status: 'rejected',
                     projectId: projectInbox.id,
                  }),
               ],
            });
         })
      );
   },
   play: async ({ canvas }) => {
      await waitFor(() => expect(fetchedRejectedOnly).toBe(true));
      await expect(canvas.queryByText('An earlier rejected plan')).toBeNull();
      await expect(canvas.queryByText('Plan')).toBeNull();
   },
};
