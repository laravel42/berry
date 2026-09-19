import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import QuickActionsSettings from './quick-actions-settings';
import { apiError, page, quickActions, seedSession, workspaceAgents } from './stories-fixtures';

const meta = {
   component: QuickActionsSettings,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(
         http.get('*/api/v1/catalogs/:ws/quick-actions', () =>
            HttpResponse.json(page(quickActions))
         ),
         http.get('*/api/v1/agents', () => HttpResponse.json(page(workspaceAgents))),
         http.patch('*/api/v1/catalogs/:ws/quick-actions/:id', ({ params }) => {
            const found = quickActions.find((entry) => entry.id === params.id);
            return HttpResponse.json({ ...found, archivedAt: null });
         })
      );
   },
} satisfies Meta<typeof QuickActionsSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Actions: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(await canvas.findByText('Write tests')).toBeVisible();
      await expect(await canvas.findByText(/Backend Engineer · Team · run 42 times/)).toBeVisible();
      // Not run in 90 days: flagged, not hidden.
      await expect(canvas.getByText('stale')).toBeVisible();
      // Archived actions sit behind a toggle and can come back.
      await userEvent.click(canvas.getByRole('switch'));
      await userEvent.click(canvas.getByRole('button', { name: 'Restore' }));
      await expect(canvas.queryByRole('switch')).toBeNull();
   },
};

export const UnfillableVariable: Story = {
   play: async ({ canvas, userEvent }) => {
      await canvas.findByText('Write tests');
      // Braces must be escaped for userEvent.type.
      await userEvent.type(
         canvas.getByPlaceholderText('Prompt'),
         'Ping {{{{issue.assignee}} about {{{{issue.title}}'
      );
      await expect(canvas.getByRole('alert')).toHaveTextContent(
         'Berry cannot fill {{issue.assignee}}.'
      );
      await expect(canvas.getByRole('button', { name: 'Add' })).toBeDisabled();
   },
};

export const Empty: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/catalogs/:ws/quick-actions', () => HttpResponse.json(page([]))));
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/catalogs/:ws/quick-actions', () =>
            apiError(500, 'Quick actions could not be loaded.')
         )
      );
   },
};
