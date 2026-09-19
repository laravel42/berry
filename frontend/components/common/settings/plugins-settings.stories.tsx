import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import PluginsSettings from './plugins-settings';
import { apiError, installedPlugin, pluginPreview, seedSession } from './stories-fixtures';

const meta = {
   component: PluginsSettings,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      nextjs: { navigation: { segments: [['orgId', 'elian']] } },
   },
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(
         http.get('*/api/v1/plugins/:ws/installations', () =>
            HttpResponse.json({
               nodes: [
                  installedPlugin,
                  {
                     ...installedPlugin,
                     id: 'plg-2',
                     key: 'pagerduty-bridge',
                     name: 'PagerDuty bridge',
                     version: '2.0.0',
                     enabled: false,
                  },
               ],
            })
         ),
         http.post('*/api/v1/plugins/:ws/preview', () => HttpResponse.json(pluginPreview)),
         http.post('*/api/v1/plugins/:ws/installations', () =>
            HttpResponse.json({
               installation: {
                  ...installedPlugin,
                  id: 'plg-3',
                  key: pluginPreview.key,
                  name: pluginPreview.name,
                  version: pluginPreview.version,
               },
               signingSecret: 'whsec_9b1f3c7e2a4d6f8b0c1e3a5d7f9b2c4e',
            })
         )
      );
   },
} satisfies Meta<typeof PluginsSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Installed: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('standup-digest · v1.4.0')).toBeVisible();
      await expect(canvas.getByText('Disabled')).toBeVisible();
   },
};

export const PreviewThenInstall: Story = {
   play: async ({ canvas, userEvent }) => {
      await canvas.findByText('Standup digest');
      await userEvent.type(
         canvas.getByPlaceholderText('https://…/berry-plugin.json'),
         'https://plugins.elian.dev/release-notes/berry-plugin.json'
      );
      await userEvent.click(canvas.getByRole('button', { name: 'Preview' }));
      // Everything the package asks for is listed before anything is stored.
      await expect(await canvas.findByText('Release notes v0.3.1')).toBeVisible();
      await expect(canvas.getByText('weekly every 10080 min')).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'Install' }));
      await expect(await canvas.findByText('whsec_9b1f3c7e2a4d6f8b0c1e3a5d7f9b2c4e')).toBeVisible();
   },
};

export const Empty: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/plugins/:ws/installations', () => HttpResponse.json({ nodes: [] }))
      );
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/plugins/:ws/installations', () =>
            apiError(503, 'Plugins are disabled on this deployment.')
         )
      );
   },
};
