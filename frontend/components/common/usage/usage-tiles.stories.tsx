import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { bucket, workspaceUsage } from './stories-fixtures';
import { UsageTiles } from './usage-tiles';

const meta = {
   component: UsageTiles,
   tags: ['ai-generated', 'needs-work'],
   args: { totals: bucket('total', 25.5), runs: workspaceUsage.runs },
   decorators: [
      (Story) => (
         <div className="w-[960px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof UsageTiles>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A workspace window: money, tokens, cache and the runs behind them. */
export const WithRuns: Story = {};

/** An issue or agent read carries no run totals, so only three tiles show. */
export const WithoutRuns: Story = { args: { runs: undefined } };

export const UnpricedModels: Story = {
   args: { totals: { ...bucket('total', 25.5), unpricedEvents: 3 } },
   play: async ({ canvas }) => {
      await expect(
         canvas.getByText(/3 of 306 usage reports used a model with no published price/)
      ).toBeVisible();
   },
};

export const Empty: Story = {
   args: { totals: bucket('total', 0), runs: { runs: 0, failed: 0, runSeconds: 0 } },
};
