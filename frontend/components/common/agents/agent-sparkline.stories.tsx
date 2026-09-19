import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { AgentSparkline } from './agent-sparkline';
import { rosterNodes } from './stories-fixtures';

type Activity = (typeof rosterNodes)[number]['activity'];

function weekProps(activity: Activity) {
   const runs = activity.reduce((sum, point) => sum + point.runs, 0);
   const failed = activity.reduce((sum, point) => sum + point.failed, 0);
   return {
      activity,
      emptyLabel: 'No runs',
      weekTitle: 'Last 7 days',
      weekSummary: `${runs} runs · ${failed} failed (${
         runs === 0 ? 0 : Math.round((failed / runs) * 100)
      }% fail rate)`,
      describe: (point: { day: string; runs: number; failed: number; percent: number }) =>
         `${point.day}: ${point.runs} runs, ${point.failed} failed (${point.percent}%)`,
   };
}

const meta = {
   component: AgentSparkline,
   tags: ['ai-generated', 'needs-work'],
   args: weekProps(rosterNodes[1]!.activity),
} satisfies Meta<typeof AgentSparkline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BusyWeek: Story = {
   play: async ({ canvas }) => {
      const chart = canvas.getByRole('img');
      await expect(chart).toHaveAccessibleName(/Last 7 days/);
      await expect(chart).toHaveAccessibleName(/26 runs/);
   },
};

/** Failures drawn as the bottom of each column. */
export const WithFailures: Story = {
   args: weekProps(
      rosterNodes[1]!.activity.map((point, index) =>
         index === 6 ? { ...point, failed: 3 } : point
      )
   ),
};

/** One run all week: most days are gaps on the baseline. */
export const Sparse: Story = { args: weekProps(rosterNodes[2]!.activity) };

export const NoRuns: Story = {
   args: weekProps(rosterNodes[3]!.activity),
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No runs')).toBeVisible();
      await expect(canvas.queryByRole('img')).toBeNull();
   },
};
