import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { ProjectProgressChart } from './project-progress-chart';

const meta = {
   component: ProjectProgressChart,
   tags: ['ai-generated', 'needs-work'],
   args: { startDate: '2026-08-03', endDate: '2026-10-30', scope: 5, started: 1, completed: 3 },
   decorators: [
      (Story) => (
         // The width of the project side panel's Progress card.
         <div className="w-[340px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ProjectProgressChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InFlight: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Aug 3')).toBeVisible();
      await expect(canvas.getByText('Oct 30')).toBeVisible();
   },
};

export const JustStarted: Story = { args: { scope: 12, started: 2, completed: 0 } };

export const Finished: Story = { args: { scope: 8, started: 0, completed: 8 } };

/** No tasks yet: flat lines, still dated. */
export const NoScope: Story = { args: { scope: 0, started: 0, completed: 0 } };
