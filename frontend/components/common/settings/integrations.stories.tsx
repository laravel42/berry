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
