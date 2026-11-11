import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { apiRepositories, seedProjectStores } from '@/components/common/projects/stories-fixtures';
import { useUiPrefsStore } from '@/store/ui-prefs-store';
import { ChatRepositorySelect } from './chat-repository-select';

function settingsHandler(enabled: boolean) {
   return http.get('*/api/v1/github/:workspaceId/settings', () =>
      HttpResponse.json({
         settings: {
            enabled,
            showLinkedPullRequests: true,
            coAuthorTrailer: false,
            autoLinkPullRequests: false,
         },
         canManage: false,
         connection: { appConfigured: true, installed: true, accounts: [] },
      })
   );
}

const meta = {
   component: ChatRepositorySelect,
   tags: ['ai-generated'],
   args: { workspaceId: 'ws-1', disabled: false },
   beforeEach: ({ msw }) => {
      seedProjectStores();
      useUiPrefsStore.setState({ chatRepository: null });
      msw.use(
         settingsHandler(true),
         http.get('*/api/v1/integrations/providers', () =>
            HttpResponse.json({
               providers: [{ id: 'github', name: 'GitHub', connected: true, configured: true }],
            })
         ),
         http.get('*/api/v1/integrations/github/repositories', () =>
            HttpResponse.json(apiRepositories)
         )
      );
   },
} satisfies Meta<typeof ChatRepositorySelect>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing chosen yet: the button just names the control. */
export const Collapsed: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('button', { name: 'Repository' })).toBeVisible();
   },
};

/** Opening the picker lists this workspace's repositories. */
export const OpenListsRepositories: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Repository' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('option', { name: /berry-dev\/berry/ })).toBeVisible();
      await expect(body.getByRole('option', { name: /plugin-sdk/ })).toBeVisible();
   },
};

/** Picking a repository saves it to this machine's chat preferences. */
export const PickARepository: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Repository' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /berry-dev\/plugin-sdk/ }));
      await expect(
         await canvas.findByRole('button', { name: 'berry-dev/plugin-sdk' })
      ).toBeVisible();
      await waitFor(() =>
         expect(useUiPrefsStore.getState().chatRepository).toBe('berry-dev/plugin-sdk')
      );
   },
};

/** GitHub turned off for this workspace: nothing renders at all. */
export const HiddenWhenGitHubOff: Story = {
   beforeEach: ({ msw }) => {
      seedProjectStores();
      useUiPrefsStore.setState({ chatRepository: null });
      msw.use(settingsHandler(false));
   },
   play: async ({ canvasElement }) => {
      await waitFor(() => expect(within(canvasElement).queryByRole('button')).toBeNull());
   },
};
