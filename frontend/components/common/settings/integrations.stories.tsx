import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import Integrations from './integrations';
import {
   apiError,
   githubAccounts,
   githubSettingsState,
   integrationConnections,
   integrationGrants,
   integrationProviders,
   seedSession,
} from './stories-fixtures';

const meta = {
   component: Integrations,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      nextjs: { navigation: { pathname: '/elian/settings/integrations' } },
   },
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(
         http.get('*/api/v1/config', () => HttpResponse.json({ capabilities: { nango: false } })),
         http.get('*/api/v1/integrations/providers', () =>
            HttpResponse.json({ providers: integrationProviders })
         ),
         http.get('*/api/v1/integrations/connections', () =>
            HttpResponse.json({ connections: integrationConnections })
         ),
         http.get('*/api/v1/integrations/grants', () =>
            HttpResponse.json({ grants: integrationGrants })
         ),
         http.delete(
            '*/api/v1/integrations/connections/:provider',
            () => new HttpResponse(null, { status: 204 })
         ),
         http.get('*/api/v1/github/:ws/settings', () => HttpResponse.json(githubSettingsState)),
         http.get('*/api/v1/github/:ws/accounts', () =>
            HttpResponse.json({ accounts: githubAccounts, installPending: false })
         ),
         http.get('*/api/v1/gitlab/:ws/settings', () =>
            HttpResponse.json({
               settings: {
                  enabled: true,
                  showLinkedMergeRequests: true,
                  coAuthorTrailer: true,
                  autoLinkMergeRequests: true,
                  updatedAt: '2026-10-11T10:00:00Z',
               },
               canManage: true,
            })
         )
      );
   },
} satisfies Meta<typeof Integrations>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Directory: Story = {
   play: async ({ canvas, userEvent }) => {
      const slack = await canvas.findByRole('region', { name: 'Slack' });
      await expect(within(slack).getByText(/as Elian HQ · since 14 Jul 2026/)).toBeVisible();
      // The tools table is collapsed until asked for.
      const toggle = within(slack).getByRole('button', { name: /3 tools/ });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(toggle);
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(within(slack).getByText('post_message')).toBeVisible();
      // An expired connection says why rather than reading as never connected.
      const notion = canvas.getByRole('region', { name: 'Notion' });
      await expect(within(notion).getByText('Expired')).toBeVisible();
      await expect(
         within(notion).getByText(/The refresh token was revoked in Notion/)
      ).toBeVisible();
   },
};

/** Clicking GitHub opens the workspace switches in the drawer. */
export const GitHubOAuthDrawer: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      const github = await canvas.findByRole('region', { name: 'GitHub' });
      await expect(canvas.queryByText('Use GitHub in this workspace')).not.toBeInTheDocument();
      await userEvent.click(
         within(github).getByRole('button', { name: /The repositories your agents check out/ })
      );
      const body = within(canvasElement.ownerDocument.body);
      const drawer = await body.findByRole('dialog');
      await expect(within(drawer).getByText('Use GitHub in this workspace')).toBeVisible();
      await expect(within(drawer).getByText('Pull requests on tasks')).toBeVisible();
      await expect(within(drawer).getByRole('button', { name: 'Integrations' })).toBeVisible();
   },
};

/** Clicking GitLab opens the same drawer shape as GitHub. */
export const GitLabSettingsDrawer: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      const gitlab = await canvas.findByRole('region', { name: 'GitLab' });
      await expect(canvas.queryByText('Use GitLab in this workspace')).not.toBeInTheDocument();
      await userEvent.click(
         within(gitlab).getByRole('button', { name: /Connect a GitLab account/ })
      );
      const body = within(canvasElement.ownerDocument.body);
      const drawer = await body.findByRole('dialog');
      await expect(within(drawer).getByText('Use GitLab in this workspace')).toBeVisible();
      await expect(within(drawer).getByText('Merge requests on tasks')).toBeVisible();
      await expect(within(drawer).getByRole('button', { name: 'Integrations' })).toBeVisible();
      await expect(within(drawer).getByRole('button', { name: 'Disconnect' })).toBeVisible();
   },
};

/** Clicking GitHub opens its workspace settings in the drawer, not on the page. */
export const GitHubSettingsDrawer: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      const github = await canvas.findByRole('region', { name: 'GitHub' });
      await expect(canvas.queryByText('Use GitHub in this workspace')).not.toBeInTheDocument();
      await userEvent.click(
         within(github).getByRole('button', { name: /The repositories your agents check out/ })
      );
      const body = within(canvasElement.ownerDocument.body);
      const drawer = await body.findByRole('dialog');
      await expect(within(drawer).getByText('Use GitHub in this workspace')).toBeVisible();
      await expect(within(drawer).getByRole('button', { name: 'Integrations' })).toBeVisible();
   },
};

export const DisconnectConfirm: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      const slack = await canvas.findByRole('region', { name: 'Slack' });
      await userEvent.click(within(slack).getByRole('button', { name: 'Disconnect' }));
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('alertdialog', { name: 'Disconnect Slack?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
      await expect(await body.findByText('Slack disconnected')).toBeVisible();
   },
};

export const OAuthCallback: Story = {
   parameters: {
      nextjs: {
         navigation: {
            pathname: '/elian/settings/integrations',
            query: { integration: 'slack', status: 'denied' },
         },
      },
   },
   play: async ({ canvasElement }) => {
      // The provider's answer is announced once as a toast.
      const body = within(canvasElement.ownerDocument.body);
      await expect(
         await body.findByText('Slack was not connected: access was denied.')
      ).toBeVisible();
   },
};

export const ProvidersFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/integrations/providers', () =>
            apiError(503, 'Integrations are unavailable.', 'SERVICE_UNAVAILABLE')
         )
      );
   },
};
