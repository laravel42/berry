import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse, delay } from 'msw';
import { expect } from 'storybook/test';

import { seedAdminSession } from '../usage/stories-fixtures';
import PluginSurface from './plugin-surface';

/**
 * A real launch URL points at the plugin's own origin with a token in the
 * fragment. The story serves an inline page instead so the frame has
 * something to show without reaching the network.
 */
const pluginPage = `data:text/html,${encodeURIComponent(
   '<body style="font:14px system-ui;color:#ddd;background:#111;padding:24px">' +
      '<h2>Standup digest</h2><p>3 tasks moved to review since yesterday.</p></body>'
)}`;

const LAUNCH = '*/api/v1/plugins/:workspaceId/installations/:pluginId/surfaces/:surface/launch';

const meta = {
   component: PluginSurface,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      nextjs: {
         navigation: {
            segments: [
               ['orgId', 'elian'],
               ['pluginId', 'plg-standup'],
               ['surface', 'digest'],
            ],
         },
      },
   },
   beforeEach: ({ msw }) => {
      seedAdminSession();
      msw.use(
         http.post(LAUNCH, () =>
            HttpResponse.json({ url: pluginPage, expiresAt: '2026-09-18T12:05:00Z' })
         )
      );
   },
   decorators: [
      (Story) => (
         <div className="h-[420px] w-[800px] border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof PluginSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The launch URL from the server becomes a sandboxed, referrer-less frame. */
export const Opened: Story = {
   play: async ({ canvas }) => {
      const frame = await canvas.findByTitle('Plugin page');
      await expect(frame).toHaveAttribute('src', pluginPage);
      await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
      await expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation');
   },
};

export const Opening: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post(LAUNCH, async () => {
            await delay('infinite');
            return HttpResponse.json({});
         })
      );
   },
};

export const Unavailable: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post(LAUNCH, () =>
            HttpResponse.json(
               {
                  error: {
                     code: 'NOT_FOUND',
                     message: 'This plugin has no page called “digest”.',
                  },
               },
               { status: 404 }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('This plugin has no page called “digest”.')
      ).toBeVisible();
   },
};
