import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { tierUsage } from './stories-fixtures';
import { UsageTiersTable } from './usage-tiers-table';

const meta = {
   component: UsageTiersTable,
   tags: ['ai-generated', 'needs-work'],
   args: { rows: tierUsage.tiers },
   decorators: [
      (Story) => (
         <div className="w-[640px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof UsageTiersTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Rows in tier order whatever the server sent; BerryAuto has unpriced records, so the column shows. */
export const Tiers: Story = {
   play: async ({ canvas }) => {
      const rows = canvas.getAllByRole('row').slice(1);
      await expect(within(rows[0]!).getByText('BerryMax')).toBeVisible();
      await expect(canvas.getByRole('columnheader', { name: 'Unpriced' })).toBeVisible();
   },
};

/** Every record priced: no Unpriced column. */
export const AllPriced: Story = {
   args: { rows: tierUsage.tiers.filter((row) => row.unpricedRecords === 0) },
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('columnheader', { name: 'Unpriced' })).toBeNull();
   },
};

export const Empty: Story = { args: { rows: [] } };

/** Unpriced subscription usage must not make the average look cheaper. */
export const PartialPricing: Story = {
   args: { rows: [{ ...tierUsage.tiers[0]!, runs: 2, costMicros: 10_000_000, unpricedRecords: 1 }] },
   play: async ({ canvas }) => {
      const row = canvas.getAllByRole('row')[1];
      await expect(row).toBeDefined();
      const average = within(row!).getAllByRole('cell')[3];
      await expect(average).toHaveTextContent('—');
      await expect(average).toHaveAttribute('title', 'Average unavailable because some usage has no price. Subscription usage is not zero-cost API usage.');
   },
};
