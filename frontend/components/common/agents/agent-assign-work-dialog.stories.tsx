import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor, within } from 'storybook/test';
import { useIssuesStore } from '@/store/issues-store';
import AgentAssignWorkDialog from './agent-assign-work-dialog';
import { frontendAgent, seedSession } from './stories-fixtures';

const meta = {
   component: AgentAssignWorkDialog,
   tags: ['ai-generated', 'needs-work'],
   args: { agent: frontendAgent, open: true, onOpenChange: fn() },
   beforeEach: () => {
      seedSession();
      useIssuesStore.getState().hydrateIssues([]);
   },
} satisfies Meta<typeof AgentAssignWorkDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      // Nothing to hand over until there is a title.
      await expect(await body.findByRole('button', { name: 'Assign work' })).toBeDisabled();
   },
};

export const Submit: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/issues', () =>
            HttpResponse.json(
               { error: { code: 'VALIDATION', message: 'Board is read-only' } },
               { status: 422 }
            )
         )
      );
   },
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.type(
         await body.findByRole('textbox', { name: 'Name' }),
         'Audit the settings forms for missing error states'
      );
      await userEvent.click(body.getByRole('button', { name: 'Assign work' }));
      // The server's own message is what the toast says.
      await waitFor(() => expect(body.getByText('Board is read-only')).toBeVisible());
   },
};
