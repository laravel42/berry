import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';

import { RuntimeUsagePanel } from './runtime-usage-panel';
import {
   emptyRuntimeUsage,
   errorEnvelope,
   seedAdminSession,
   usageHandlers,
} from './stories-fixtures';

const meta = {
   component: RuntimeUsagePanel,
   tags: ['ai-generated', 'needs-work'],
   args: { runtimeId: 'rt-platform', query: { days: 180, timezone: 'UTC' } },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'elian']] } } },
   beforeEach: ({ msw }) => {
      seedAdminSession();
      msw.use(...usageHandlers);
   },
   decorators: [
      (Story) => (
         <div className="w-[1000px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof RuntimeUsagePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Half a year on the platform runtime; switching the split re-ranks by model. */
export const Loaded: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(await canvas.findByRole('img', { name: 'Half a year of spend' })).toBeVisible();
      await expect(canvas.getByRole('link', { name: 'Code Reviewer' })).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'By model' }));
      await expect(canvas.getByRole('heading', { name: 'By model' })).toBeVisible();
      await expect(canvas.queryByRole('link', { name: 'Code Reviewer' })).toBeNull();
      await expect(canvas.getByText(/their cost is missing rather than zero/)).toBeVisible();
   },
};

export const NothingSpent: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/usage/:workspaceId/runtimes/:runtimeId', () =>
            HttpResponse.json(emptyRuntimeUsage)
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Nothing was spent in this window.')).toBeVisible();
   },
};

export const Failed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/usage/:workspaceId/runtimes/:runtimeId', () =>
            errorEnvelope(404, 'NOT_FOUND', 'Runtime not found.')
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Runtime not found.')).toBeVisible();
   },
};
