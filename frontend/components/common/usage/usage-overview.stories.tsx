import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse, delay } from 'msw';
import { expect, waitFor } from 'storybook/test';

import {
   emptyWorkspaceUsage,
   errorEnvelope,
   seedAdminSession,
   usageHandlers,
} from './stories-fixtures';
import UsageOverview from './usage-overview';

const meta = {
   component: UsageOverview,
   tags: ['ai-generated', 'needs-work'],
   args: { query: { days: 30, timezone: 'UTC', boardId: null } },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'elian']] } } },
   beforeEach: ({ msw }) => {
      seedAdminSession();
      msw.use(...usageHandlers);
   },
   decorators: [
      (Story) => (
         <div className="w-[1100px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof UsageOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Tiles, trend and both leaderboards from `GET /api/v1/usage/{ws}/summary`. */
export const Loaded: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('heading', { name: 'Agents by spend' })).toBeVisible();
      await expect(canvas.getByRole('link', { name: 'Engineer' })).toHaveAttribute(
         'href',
         '/elian/agents/agent-eng'
      );
      await expect(canvas.getByText('Claude Sonnet 4.5')).toBeVisible();
   },
};

export const NoUsage: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/usage/:workspaceId/summary', () =>
            HttpResponse.json(emptyWorkspaceUsage)
         )
      );
   },
   play: async ({ canvas }) => {
      // Both breakdown tables say so; findAll resolves on the first, so wait for
      // both, with headroom for a loaded batch run.
      await waitFor(() => expect(canvas.getAllByText('No usage in this window.')).toHaveLength(2), {
         timeout: 5000,
      });
   },
};

export const Loading: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/usage/:workspaceId/summary', async () => {
            await delay('infinite');
            return HttpResponse.json(emptyWorkspaceUsage);
         })
      );
   },
};

export const Failed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/usage/:workspaceId/summary', () =>
            errorEnvelope(403, 'FORBIDDEN', 'You cannot read usage in this workspace.')
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('You cannot read usage in this workspace.')
      ).toBeVisible();
   },
};
