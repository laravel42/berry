import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import type { Goal } from '@/lib/goals';
import { useGoalsStore } from '@/store/goals-store';
import { workspaceRoute } from '../../stories-fixtures';
import Header from './header';

const goal: Goal = {
   id: 'goal-1',
   workspaceId: 'ws-1',
   projectId: 'proj-2',
   title: 'Ship the inbox',
   description: 'Approvals and proposals move into the inbox.',
   status: 'active',
   createdBy: { type: 'user', id: 'user-1', name: 'Elian Rossi', avatarUrl: null },
   createdAt: '2026-09-01T09:00:00Z',
   updatedAt: '2026-09-17T17:40:00Z',
   startedAt: '2026-09-02T09:00:00Z',
   completedAt: null,
   progress: { issuesTotal: 6, issuesDone: 3, issuesCancelled: 0, approvalsPending: 1 },
};

const meta = {
   component: Header,
   tags: ['ai-generated', 'needs-work'],
   args: { goalId: 'goal-1' },
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/goal/goal-1', [['goalId', 'goal-1']]) },
   },
   beforeEach: ({ msw }) => {
      useGoalsStore.setState({ goals: [goal], loaded: true, error: null });
      msw.use(http.delete('*/api/v1/goals/:id', () => new HttpResponse(null, { status: 204 })));
   },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {};

export const Blocked: Story = {
   beforeEach: () => {
      useGoalsStore.setState({ goals: [{ ...goal, status: 'blocked' }] });
   },
};

/** Archiving asks first, then drops the goal from the store. */
export const Archive: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Goal actions' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Archive' }));
      const confirm = await body.findByRole('alertdialog', { name: 'Archive “Ship the inbox”?' });
      await userEvent.click(within(confirm).getByRole('button', { name: 'Archive' }));
      await expect(await body.findByText('Goal archived')).toBeVisible();
      await expect(useGoalsStore.getState().goals).toHaveLength(0);
   },
};

/** Before the goal arrives the actions are held back. */
export const Loading: Story = {
   beforeEach: () => {
      useGoalsStore.setState({ goals: [] });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Loading goal…')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Goal actions' })).toBeDisabled();
   },
};
