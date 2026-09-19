import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor } from 'storybook/test';
import { GitHubIntegrationSettings } from './github-integration-settings';
import {
   apiError,
   githubAccounts,
   githubSettingsState,
   memberWorkspace,
   seedSession,
} from './stories-fixtures';

const meta = {
   component: GitHubIntegrationSettings,
   tags: ['ai-generated', 'needs-work'],
   args: { source: 'app' },
   decorators: [
      (Story) => (
         <div className="max-w-2xl">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(
         http.get('*/api/v1/github/:ws/settings', () => HttpResponse.json(githubSettingsState)),
         http.patch('*/api/v1/github/:ws/settings', async ({ request }) => {
            const patch = (await request.json()) as Record<string, boolean>;
            return HttpResponse.json({
               settings: { ...githubSettingsState.settings, ...patch },
            });
         }),
         http.get('*/api/v1/github/:ws/accounts', () =>
            HttpResponse.json({ accounts: githubAccounts, installPending: false })
         )
      );
   },
} satisfies Meta<typeof GitHubIntegrationSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConnectedViaApp: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(
         await canvas.findByText('Connected to 2 accounts since 3 Jun 2026')
      ).toBeVisible();
      const trailer = canvas.getByRole('switch', { name: 'Credit the requester on agent commits' });
      await expect(trailer).toHaveAttribute('aria-checked', 'false');
      await userEvent.click(trailer);
      await waitFor(() => expect(trailer).toHaveAttribute('aria-checked', 'true'));
   },
};

export const ViaSignInOnly: Story = {
   args: { source: 'sign-in' },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/github/:ws/settings', () =>
            HttpResponse.json({
               ...githubSettingsState,
               connection: {
                  ...githubSettingsState.connection,
                  installed: false,
                  accounts: [],
                  accountLogin: null,
                  installedAt: null,
                  installedBy: null,
               },
            })
         ),
         http.get('*/api/v1/github/:ws/accounts', () =>
            HttpResponse.json({ accounts: [], installPending: false })
         )
      );
   },
};

export const MemberReadOnly: Story = {
   beforeEach: ({ msw }) => {
      seedSession(memberWorkspace);
      msw.use(
         http.get('*/api/v1/github/:ws/settings', () =>
            HttpResponse.json({ ...githubSettingsState, canManage: false })
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('Only workspace admins can change these settings.')
      ).toBeVisible();
      for (const toggle of canvas.getAllByRole('switch')) await expect(toggle).toBeDisabled();
   },
};

export const Disabled: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/github/:ws/settings', () =>
            HttpResponse.json({
               ...githubSettingsState,
               settings: { ...githubSettingsState.settings, enabled: false },
            })
         )
      );
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/github/:ws/settings', () =>
            apiError(503, 'unavailable', 'INTEGRATIONS_NOT_CONFIGURED')
         )
      );
   },
};
