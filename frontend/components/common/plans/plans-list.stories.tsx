import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { expect, waitFor } from 'storybook/test';
import type { PlanSummary } from '@/lib/plans';
import { seedProjectStores } from '../projects/stories-fixtures';
import { usePlansListStore } from '@/store/plans-list-store';
import PlansList from './plans-list';

function plan(overrides: Partial<PlanSummary> & Pick<PlanSummary, 'id' | 'title'>): PlanSummary {
   return {
      status: 'draft',
      projectId: null,
      projectName: null,
      goalId: null,
      generation: { status: 'succeeded', error: null, stage: 'finalize' },
      validationStatus: 'valid',
      compileStatus: 'idle',
      routingStatus: null,
      plannedTasks: 4,
      createdTasks: 0,
      finishedTasks: 0,
      autoGate: false,
      archived: false,
      createdAt: '2026-09-18T09:00:00Z',
      updatedAt: '2026-09-18T09:00:00Z',
      ...overrides,
   };
}

const plans: PlanSummary[] = [
   plan({
      id: 'plan-1',
      title: 'Persist project health and weekly updates',
      projectName: 'Persist project health',
      status: 'approved',
      createdTasks: 5,
      finishedTasks: 2,
   }),
   plan({
      id: 'plan-2',
      title: 'Backfill health for older projects',
      projectName: 'Persist project health',
      status: 'pendingApproval',
   }),
];

const answer = (nodes: PlanSummary[]) =>
   http.get('*/api/v1/plans', () => HttpResponse.json({ nodes }));

const meta = {
   component: PlansList,
   tags: ['ai-generated', 'needs-work'],
   decorators: [
      (Story) => (
         <NuqsTestingAdapter>
            <div className="h-[560px] w-[760px]">
               <Story />
            </div>
         </NuqsTestingAdapter>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedProjectStores({ sessionReady: true });
      usePlansListStore.setState({ scope: 'open', query: '', counts: { open: null, all: null } });
      msw.use(answer(plans));
   },
} satisfies Meta<typeof PlansList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every open plan, with its progress; the first is selected automatically at this width. */
export const OpenPlans: Story = {
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('Persist project health and weekly updates')
      ).toBeVisible();
      await expect(canvas.getByText('Backfill health for older projects')).toBeVisible();
      await expect(canvas.getByText('2 of 5 done')).toBeVisible();
   },
};

/** No open plans: the empty state still offers a way to ask for one. */
export const NoOpenPlans: Story = {
   beforeEach: ({ msw }) => {
      msw.use(answer([]));
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('No open plans.')).toBeVisible();
   },
};

/** Searching narrows the rail to plans matching the title or project. */
export const SearchNarrowsTheList: Story = {
   play: async ({ canvas, userEvent }) => {
      await canvas.findByText('Persist project health and weekly updates');
      await userEvent.type(canvas.getByPlaceholderText('Search plans'), 'backfill');
      await waitFor(() =>
         expect(canvas.queryByText('Persist project health and weekly updates')).toBeNull()
      );
      await expect(canvas.getByText('Backfill health for older projects')).toBeVisible();
   },
};

/** The list could not be read: the rail says so rather than looking empty. */
export const FailedToLoad: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/plans', () => HttpResponse.error()));
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('alert')).toHaveTextContent(
         'Plans could not be loaded.'
      );
   },
};
