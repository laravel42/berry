import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
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
         http.get('*/api/v1/plugins/:ws/catalog', () => HttpResponse.json({ nodes: [] })),
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
      await expect(
         await canvas.findByText('Posts a morning summary of what changed overnight.')
      ).toBeVisible();
      await expect(canvas.getByText('Disabled')).toBeVisible();
   },
};

export const PreviewThenInstall: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/plugins/:ws/catalog', () =>
            HttpResponse.json({
               nodes: [{ preview: pluginPreview, package: { manifest: pluginPreview } }],
            })
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await canvas.findByText('Release notes');
      await userEvent.click(
         canvas.getByRole('button', { name: /Drafts release notes from merged tasks/ })
      );
      const body = within(canvasElement.ownerDocument.body);
      // The review opens in a dialog, which is portaled onto the document.
      await expect(await body.findByRole('dialog')).toBeVisible();
      await expect(body.getByRole('heading', { name: 'Release notes' })).toBeVisible();
      await expect(body.getByText('Tone')).toBeVisible();
      await expect(body.getByText('GITHUB_TOKEN')).toBeVisible();
      await userEvent.click(body.getByRole('button', { name: 'Install' }));
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
