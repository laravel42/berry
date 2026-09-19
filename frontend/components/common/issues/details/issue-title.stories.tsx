import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { useIssuesStore } from '@/store/issues-store';
import { IssueTitle } from './issue-title';
import { issueApiHandlers, persistHealth, seedIssuesWorkspace } from '../stories-fixtures';

const meta = {
   component: IssueTitle,
   tags: ['ai-generated', 'needs-work'],
   args: { issue: persistHealth },
   decorators: [
      (Story) => (
         <div className="w-[720px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace();
      msw.use(...issueApiHandlers);
   },
} satisfies Meta<typeof IssueTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Reading: Story = {
   play: async ({ canvas }) => {
      await expect(
         canvas.getByRole('heading', { level: 1, name: 'Persist project health and updates' })
      ).toBeInTheDocument();
   },
};

export const LongTitle: Story = {
   args: {
      issue: {
         ...persistHealth,
         title: 'Persist project health and updates, backfill the last thirty days from the audit log, and expose both through the public v1 API',
      },
   },
};

export const RenameWithEnter: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Edit the title' }));
      const field = canvas.getByRole('textbox', { name: 'Edit the title' });
      await userEvent.clear(field);
      await userEvent.type(field, 'Persist project health{Enter}');
      await waitFor(() =>
         expect(useIssuesStore.getState().getIssueById(persistHealth.id)?.title).toBe(
            'Persist project health'
         )
      );
   },
};

export const EmptyTitleRefused: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Edit the title' }));
      await userEvent.clear(canvas.getByRole('textbox', { name: 'Edit the title' }));
      await userEvent.keyboard('{Enter}');
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('A task needs a title.')).toBeVisible();
   },
};

export const SaveFails: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.patch('*/api/v1/issues/:ref', () =>
            HttpResponse.json(
               { error: { code: 'INTERNAL', message: 'Boom', details: null } },
               { status: 500 }
            )
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Edit the title' }));
      await userEvent.type(canvas.getByRole('textbox', { name: 'Edit the title' }), ' now{Enter}');
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('The title could not be saved.')).toBeVisible();
      await expect(useIssuesStore.getState().getIssueById(persistHealth.id)?.title).toBe(
         persistHealth.title
      );
   },
};
