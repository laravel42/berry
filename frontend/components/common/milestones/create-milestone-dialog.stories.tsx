import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { useCreateMilestoneStore } from '@/store/create-milestone-store';
import { useMilestonesStore } from '@/store/milestones-store';
import { CreateGoalDialog } from './create-milestone-dialog';
import { projectHealth, seedGoalStores, seedProjectStores } from '../projects/stories-fixtures';

const createdMilestone = {
   id: 'goal-new',
   workspaceId: 'ws-1',
   projectId: projectHealth.id,
   title: 'Ship the health chip',
   description: null,
   status: 'planned',
   targetDate: null,
   sortOrder: 1,
   createdBy: { type: 'user', id: 'user-1', name: 'Andrea Lunelio', avatarUrl: null },
   createdAt: '2026-10-16T10:00:00Z',
   updatedAt: '2026-10-16T10:00:00Z',
   startedAt: null,
   completedAt: null,
   progress: {
      issuesTotal: 0,
      issuesDone: 0,
      issuesCancelled: 0,
      issuesWorking: 0,
      approvalsPending: 0,
      percent: 0,
   },
};

const meta = {
   component: CreateGoalDialog,
   tags: ['ai-generated', 'needs-work'],
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: ({ msw }) => {
      seedProjectStores({ sessionReady: true });
      seedGoalStores([]);
      useCreateMilestoneStore.setState({ isOpen: true, prefill: {} });
      msw.use(
         http.post('*/api/v1/milestones', () =>
            HttpResponse.json(createdMilestone, { status: 201 })
         )
      );
   },
} satisfies Meta<typeof CreateGoalDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Pick a project, name the goal, submit: it lands in the store and the dialog closes. */
export const CreateFromPalette: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog'));
      const submit = dialog.getByRole('button', { name: 'Create milestone' });
      await expect(submit).toBeDisabled();

      await userEvent.type(
         dialog.getByRole('textbox', { name: 'Milestone title' }),
         'Ship the health chip'
      );
      await userEvent.click(dialog.getByRole('combobox'));
      await userEvent.click(await body.findByRole('option', { name: /Persist project health/ }));
      await userEvent.click(submit);
      await waitFor(() => expect(useCreateMilestoneStore.getState().isOpen).toBe(false));
      await expect(
         useMilestonesStore.getState().milestones.some((goal) => goal.id === 'goal-new')
      ).toBe(true);
   },
};

/** Opened from a project page: the project is locked and no picker is shown. */
export const FromProject: Story = {
   beforeEach: () => {
      useCreateMilestoneStore.setState({
         isOpen: true,
         prefill: { projectId: projectHealth.id, lockProject: true },
      });
   },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog'));
      await expect(dialog.getByText(projectHealth.name)).toBeVisible();
      await expect(dialog.queryByRole('combobox')).toBeNull();
      await expect(dialog.getByRole('button', { name: 'Create milestone' })).toBeDisabled();
   },
};

/** The server refuses: the dialog stays open and says why. */
export const Forbidden: Story = {
   beforeEach: ({ msw }) => {
      useCreateMilestoneStore.setState({
         isOpen: true,
         prefill: { projectId: projectHealth.id, lockProject: true },
      });
      msw.use(
         http.post('*/api/v1/milestones', () =>
            HttpResponse.json(
               { error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: 'req-3' } },
               { status: 403 }
            )
         )
      );
   },
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog'));
      await userEvent.type(
         dialog.getByRole('textbox', { name: 'Milestone title' }),
         'Viewer cannot file this'
      );
      await userEvent.click(dialog.getByRole('button', { name: 'Create milestone' }));
      await expect(
         await body.findByText('You are not allowed to do that to this milestone.')
      ).toBeVisible();
      await expect(useCreateMilestoneStore.getState().isOpen).toBe(true);
   },
};
