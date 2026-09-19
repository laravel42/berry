import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import PluginDetail from './plugin-detail';
import {
   apiError,
   installedPlugin,
   pluginDetail,
   pluginInvocations,
   pluginStorage,
   seedSession,
} from './stories-fixtures';

const meta = {
   component: PluginDetail,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      nextjs: {
         navigation: {
            segments: [
               ['orgId', 'elian'],
               ['pluginId', 'plg-1'],
            ],
         },
      },
   },
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(
         http.get('*/api/v1/plugins/:ws/installations/:id', () => HttpResponse.json(pluginDetail)),
         http.get('*/api/v1/plugins/:ws/installations/:id/invocations', () =>
            HttpResponse.json({ nodes: pluginInvocations })
         ),
         http.get('*/api/v1/plugins/:ws/installations/:id/storage', () =>
            HttpResponse.json({ nodes: pluginStorage })
         ),
         http.put(
            '*/api/v1/plugins/:ws/installations/:id/tools/:tool',
            async ({ params, request }) => {
               const { approved } = (await request.json()) as { approved: boolean };
               return HttpResponse.json({
                  ...installedPlugin,
                  mcpTools: installedPlugin.mcpTools.map((tool) =>
                     tool.name === params.tool ? { ...tool, approved } : tool
                  ),
               });
            }
         )
      );
   },
} satisfies Meta<typeof PluginDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('heading', { name: 'Standup digest' })).toBeVisible();
      await expect(canvas.getByText('On issue.updated, run.completed')).toBeVisible();
      await expect(canvas.getByText('Every 1440 minutes')).toBeVisible();
      await expect(
         await canvas.findByText(/HTTP 502 · 10003 ms · Upstream timed out/)
      ).toBeVisible();
   },
};

export const ApproveTool: Story = {
   play: async ({ canvas, userEvent }) => {
      await canvas.findByText('standup.snooze');
      const section = canvas.getByText('standup.snooze').closest('div.w-full') as HTMLElement;
      const toggle = within(section).getByRole('switch');
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await userEvent.click(toggle);
      await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
   },
};

export const UninstallConfirm: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Uninstall' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(
         await body.findByRole('alertdialog', { name: 'Uninstall Standup digest?' })
      ).toBeVisible();
   },
};

export const NotFound: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/plugins/:ws/installations/:id', () =>
            apiError(404, 'That plugin is not installed here.', 'NOT_FOUND')
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('That plugin is not installed here.')).toBeVisible();
   },
};
