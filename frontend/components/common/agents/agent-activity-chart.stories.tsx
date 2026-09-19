import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { AgentActivityChart } from './agent-activity-chart';
import { rosterNodes } from './stories-fixtures';

const meta = {
   component: AgentActivityChart,
   tags: ['ai-generated'],
   args: {
      activity: rosterNodes[0]!.activity,
   },
   decorators: [
      (Story) => (
         <div className="w-[720px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentActivityChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LastThirtyDays: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { name: 'Last 30 days' })).toBeVisible();
      await expect(canvas.queryByRole('group', { name: 'Date range' })).toBeNull();
      await expect(canvas.getByText(/runs ·/)).toBeVisible();
   },
};

export const Empty: Story = {
   args: { activity: [] },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No runs in the last 30 days')).toBeVisible();
   },
};
