import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, within } from 'storybook/test';
import {
   inboxItems,
   pendingApproval,
   runningRun,
   seedSession,
} from '@/components/layout/stories-fixtures';
import { useApprovalsStore } from '@/store/approvals-store';
import { InboxDetail } from './inbox-detail';

const byId = (id: string) => {
   const found = inboxItems.find((item) => item.id === id);
   if (!found) throw new Error(id);
   return found;
};

const meta = {
   component: InboxDetail,
   tags: ['ai-generated', 'needs-work'],
   args: {
      item: null,
      archived: false,
      orgId: 'elian',
      onArchive: fn(),
      onUnarchive: fn(),
      onBack: fn(),
   },
   decorators: [
      (Story) => (
         <div className="flex h-[560px] w-[720px] flex-col border bg-container">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedSession();
      useApprovalsStore.setState({ approvals: [], loaded: true, error: null });
      msw.use(
         http.get('*/api/v1/approvals/:id', () => HttpResponse.json(pendingApproval)),
         http.post('*/api/v1/issues/:id/runs', () => HttpResponse.json(runningRun))
      );
   },
} satisfies Meta<typeof InboxDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NothingSelected: Story = {};

/** An approval shows its decision card, read from the API when the store lacks it. */
export const Approval: Story = {
   args: { item: byId('n-3') },
   play: async ({ canvas }) => {
      await expect(canvas.getByText(/^Approval ·/)).toBeVisible();
      await expect(await canvas.findByRole('button', { name: 'Start' })).toBeVisible();
   },
};

export const ApprovalGone: Story = {
   args: { item: byId('n-3') },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/approvals/:id', () =>
            HttpResponse.json(
               { code: 'NOT_FOUND', message: 'Approval not found', details: null },
               { status: 404 }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('That approval is gone.')).toBeVisible();
   },
};

/** An agent outcome: the instructions it ran with, and the offer to run them again. */
export const RunFailed: Story = {
   args: { item: byId('n-4') },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await expect(canvas.getByText('Original prompt')).toBeVisible();
      await userEvent.click(
         canvas.getByRole('button', { name: 'Retry with the original context' })
      );
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('The task is running again.')).toBeVisible();
   },
};

export const GoalInArchive: Story = {
   args: { item: { ...byId('n-5'), archived: true }, archived: true },
   play: async ({ canvas, args, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Move to inbox' }));
      await expect(args.onUnarchive).toHaveBeenCalled();
   },
};

export const TaskDeleted: Story = {
   args: {
      item: { ...byId('n-6'), identifier: '', issue: undefined, issueDeleted: true },
   },
   play: async ({ canvas, args, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Back to the inbox' }));
      await expect(args.onBack).toHaveBeenCalled();
   },
};
