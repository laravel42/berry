import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { useEffect } from 'react';
import { expect, waitFor, within } from 'storybook/test';
import type { Issue } from '@/data/issues';
import { useIssuesStore } from '@/store/issues-store';
import { DeleteIssueDialog, useIssueDeletion } from './delete-issue';
import { issueApiHandlers, seedIssuesWorkspace, sharedFilter } from './stories-fixtures';

/** The confirmation as a menu opens it: asked for one task, straight away. */
function DeleteFlow({ issue }: { issue: Issue }) {
   const deletion = useIssueDeletion();
   const { request } = deletion;
   useEffect(() => request(issue), [issue, request]);
   return <DeleteIssueDialog deletion={deletion} />;
}

const meta = {
   component: DeleteFlow,
   tags: ['ai-generated', 'needs-work'],
   args: { issue: sharedFilter },
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace();
      msw.use(...issueApiHandlers);
   },
} satisfies Meta<typeof DeleteFlow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Confirm: Story = {
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Delete BERR-44?')).toBeVisible();
      await expect(body.getByText(/the identifier is not reused/)).toBeVisible();
   },
};

export const Deleted: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('button', { name: 'Delete' }));
      // Removed from the store only after the server agreed, then announced.
      await expect(await body.findByText('BERR-44 deleted')).toBeVisible();
      await expect(useIssuesStore.getState().getIssueById(sharedFilter.id)).toBeUndefined();
   },
};

export const DeleteFails: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.delete('*/api/v1/issues/:ref', () =>
            HttpResponse.json(
               { error: { code: 'ISSUE_NOT_FOUND', message: 'Not found', details: null } },
               { status: 404 }
            )
         )
      );
   },
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('button', { name: 'Delete' }));
      await expect(
         await body.findByText('This task could not be deleted. It may already be gone.')
      ).toBeVisible();
      // The dialog stays and the task stays: nothing was removed.
      await waitFor(() =>
         expect(useIssuesStore.getState().getIssueById(sharedFilter.id)).toBeDefined()
      );
   },
};
