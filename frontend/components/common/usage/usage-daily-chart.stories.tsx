import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { weeklyBuckets } from '@/lib/usage';

import { dailyBuckets, dayKeys, bucket, runtimeUsage } from './stories-fixtures';
import { UsageDailyChart } from './usage-daily-chart';

const meta = {
   component: UsageDailyChart,
   tags: ['ai-generated', 'needs-work'],
   args: { points: dailyBuckets(30), metric: 'cost' },
   decorators: [
      (Story) => (
         <div className="w-[720px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof UsageDailyChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DailyCost: Story = {};

export const WeeklyTokens: Story = {
   args: { points: weeklyBuckets(dailyBuckets(90)), metric: 'tokens' },
};

/** Hour keys (`00`..`23`) are drawn as they come, as on a runtime's page. */
export const HourlyCalls: Story = { args: { points: runtimeUsage.byHour, metric: 'calls' } };

/** Every bar is zero; the muted track still marks each day. */
export const NoSpend: Story = {
   args: { points: dayKeys(30).map((key) => bucket(key, 0)) },
};
