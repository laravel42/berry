import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import type { Milestone } from '@/lib/milestones';
import { useMilestonesStore } from '@/store/milestones-store';
import { useSessionStore } from '@/store/session-store';
import { workspaceRoute } from '../../stories-fixtures';
import Header from './header';

const goal: Milestone = {
   id: 'goal-1',
   workspaceId: 'ws-1',
   projectId: 'proj-2',
   title: 'Ship the inbox',
   description: 'Approvals and proposals move into the inbox.',
   status: 'active',
   targetDate: null,
   sortOrder: 1,
   createdBy: { type: 'user', id: 'user-1', name: 'Elian Rossi', avatarUrl: null },
   createdAt: '2026-09-01T09:00:00Z',
   updatedAt: '2026-09-17T17:40:00Z',
   startedAt: '2026-09-02T09:00:00Z',
   completedAt: null,
   progress: {
      issuesTotal: 6,
      issuesDone: 3,
      issuesCancelled: 0,
      issuesWorking: 1,
      approvalsPending: 1,
      percent: 58,
   },
};

const meta = {
   component: Header,
   tags: ['ai-generated', 'needs-work'],
   args: { milestoneId: 'goal-1' },
   parameters: {
      layout: 'fullscreen',
      nextjs: {
         navigation: workspaceRoute('/elian/milestone/goal-1', [['milestoneId', 'goal-1']]),
      },
   },
   beforeEach: ({ msw }) => {
      useMilestonesStore.setState({ milestones: [goal], loaded: true, error: null });
      useSessionStore.setState({
         workspace: { id: 'ws-1', name: 'Berry', slug: 'elian', role: 'admin' },
      });
      msw.use(
         http.delete('*/api/v1/milestones/:id', () => new HttpResponse(null, { status: 204 }))
      );
   },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {};

export const Blocked: Story = {
   beforeEach: () => {
      useMilestonesStore.setState({ milestones: [{ ...goal, status: 'blocked' }] });
   },
};

/** Removing asks first, then drops the goal from the store. */
export const Archive: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Milestone actions' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Remove' }));
      const confirm = await body.findByRole('alertdialog', { name: 'Remove “Ship the inbox”?' });
      await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
      await expect(await body.findByText('Removed Ship the inbox')).toBeVisible();
      await expect(useMilestonesStore.getState().milestones).toHaveLength(0);
   },
};

/** Before the goal arrives the actions are held back. */
export const Loading: Story = {
   beforeEach: () => {
      useMilestonesStore.setState({ milestones: [] });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Loading milestone…')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Milestone actions' })).toBeDisabled();
   },
};
