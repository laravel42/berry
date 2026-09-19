import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { useIssuesStore } from '@/store/issues-store';
import { IssuePriorityPicker, IssueStatusPicker } from './issue-pickers';
import {
   issueApiHandlers,
   persistHealth,
   seedIssuesWorkspace,
   sharedFilter,
} from './stories-fixtures';

/** Both pickers read the task from the store, so a story renders the live row. */
function LivePickers({ issueId }: { issueId: string }) {
   const issue = useIssuesStore((state) => state.getIssueById(issueId));
   if (!issue) return null;
   return (
      <div className="flex items-center gap-1">
         <IssueStatusPicker issue={issue} />
         <IssuePriorityPicker issue={issue} />
      </div>
   );
}

const meta = {
   component: LivePickers,
   args: { issueId: sharedFilter.id },
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace();
      msw.use(...issueApiHandlers);
   },
} satisfies Meta<typeof LivePickers>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('combobox', { name: 'Priority: Urgent' })).toBeVisible();
   },
};

export const ChangePriority: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox', { name: 'Priority: Urgent' }));
      // The menu is a portal; each option counts the tasks at that priority.
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /Low/ }));
      await waitFor(() =>
         expect(useIssuesStore.getState().getIssueById(sharedFilter.id)?.priority.id).toBe('low')
      );
      await expect(canvas.getByRole('combobox', { name: 'Priority: Low' })).toBeVisible();
   },
};

export const MoveToReview: Story = {
   args: { issueId: persistHealth.id },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(
         canvas.getByRole('combobox', { name: 'Change status, current In Progress' })
      );
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /In Review/ }));
      await waitFor(() =>
         expect(useIssuesStore.getState().getIssueById(persistHealth.id)?.status.id).toBe(
            'in-review'
         )
      );
   },
};

/** The optimistic change is put back once the server refuses it. */
export const SaveRefused: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.patch('*/api/v1/issues/:ref', () =>
            HttpResponse.json(
               {
                  error: {
                     code: 'FORBIDDEN',
                     message: 'You cannot change this task.',
                     details: null,
                  },
               },
               { status: 403 }
            )
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox', { name: 'Priority: Urgent' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /High/ }));
      await waitFor(() =>
         expect(useIssuesStore.getState().getIssueById(sharedFilter.id)?.priority.id).toBe('urgent')
      );
   },
};
