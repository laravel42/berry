import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor, within } from 'storybook/test';
import { useIssuesStore } from '@/store/issues-store';
import { IssueHeaderMenu } from './issue-header-menu';
import {
   approvalsInbox,
   issueApiHandlers,
   persistHealth,
   seedIssuesWorkspace,
   tightenSurfaces,
} from '../stories-fixtures';

const meta = {
   component: IssueHeaderMenu,
   tags: ['ai-generated', 'needs-work'],
   args: { issue: persistHealth, onDeleted: fn() },
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace({ withSession: true });
      msw.use(
         http.get('*/api/v1/issues/:ref/subscribers', () =>
            HttpResponse.json({ nodes: [], subscribed: false })
         ),
         ...issueApiHandlers
      );
   },
} satisfies Meta<typeof IssueHeaderMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InProgress: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Task actions' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('menuitem', { name: 'Mark done' })).toBeVisible();
      await expect(body.getByRole('menuitem', { name: 'Subscribe' })).toBeVisible();
   },
};

export const MarkDoneAsksFirst: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Task actions' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Mark done' }));
      await expect(await body.findByText('Mark BERR-42 done?')).toBeVisible();
      await userEvent.click(body.getByRole('button', { name: 'Mark done' }));
      await waitFor(() =>
         expect(useIssuesStore.getState().getIssueById(persistHealth.id)?.status.id).toBe('done')
      );
   },
};

export const InReviewSendsToReviews: Story = {
   args: { issue: approvalsInbox },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Task actions' }));
      const body = within(canvasElement.ownerDocument.body);
      // No way around the gate from here: the menu points at the decision.
      await expect(await body.findByRole('menuitem', { name: 'Decide in Reviews' })).toBeVisible();
      await expect(body.queryByRole('menuitem', { name: 'Mark done' })).toBeNull();
   },
};

export const DoneOffersReopen: Story = {
   args: { issue: tightenSurfaces },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Task actions' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('menuitem', { name: 'Reopen' })).toBeVisible();
   },
};

export const DeleteFromMenu: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Task actions' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Delete' }));
      await userEvent.click(await body.findByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(args.onDeleted).toHaveBeenCalled());
   },
};
