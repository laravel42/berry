import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, within } from 'storybook/test';
import { GitHubImportPicker } from './github-import-picker';
import { apiError, pickerPage, workspaceRepositories, WS_ID } from './stories-fixtures';

const meta = {
   component: GitHubImportPicker,
   tags: ['ai-generated', 'needs-work'],
   args: { workspaceId: WS_ID, open: true, onOpenChange: fn(), onImported: fn() },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/github/:ws/github-repositories', () => HttpResponse.json(pickerPage)),
         http.post('*/api/v1/github/:ws/repositories', () =>
            HttpResponse.json({ repositories: workspaceRepositories.slice(1, 2) })
         )
      );
   },
} satisfies Meta<typeof GitHubImportPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Grouped: Story = {
   play: async ({ args, canvasElement, userEvent }) => {
      // The dialog renders in a portal on the document body.
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('dialog', { name: 'Import from GitHub' });
      await expect(await within(dialog).findByText('berry-runtime')).toBeVisible();
      // Already-listed and archived repositories stay visible but cannot be ticked.
      await expect(within(dialog).getByText('Already in the list')).toBeVisible();
      await expect(within(dialog).getByText('Archived')).toBeVisible();
      await expect(within(dialog).getByText('Load more (37 left)')).toBeVisible();

      await userEvent.click(within(dialog).getByLabelText(/berry-runtime/));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Import 1 repository' }));
      await expect(await body.findByText('Added 1 repository')).toBeVisible();
      await expect(args.onImported).toHaveBeenCalled();
   },
};

export const NothingReachable: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/github/:ws/github-repositories', () =>
            HttpResponse.json({ accounts: [], repositories: [], total: 0, nextCursor: null })
         )
      );
   },
};

export const NotConnected: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/github/:ws/github-repositories', () =>
            apiError(409, 'not connected', 'NOT_CONNECTED')
         )
      );
   },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('alert')).toHaveTextContent(
         'Install the GitHub App for this workspace first.'
      );
   },
};
