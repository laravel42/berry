import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { MilestoneProgress } from './milestone-progress';

const meta = {
   component: MilestoneProgress,
   tags: ['ai-generated', 'needs-work'],
   args: {
      progress: {
         issuesTotal: 5,
         issuesDone: 3,
         issuesCancelled: 0,
         issuesWorking: 0,
         approvalsPending: 2,
         percent: 60,
      },
   },
   decorators: [
      (Story) => (
         <div className="w-[480px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof MilestoneProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Header: percentage, counts and pending approvals. */
export const Full: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('60%')).toBeVisible();
      await expect(canvas.getByText('3 of 5 tasks done · 2 approvals pending')).toBeVisible();
   },
};

/** List row: bar and percent. */
export const Compact: Story = {
   args: { compact: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('60%')).toBeVisible();
   },
};

/** Compact with no tasks still shows 0%. */
export const CompactNoTasks: Story = {
   args: {
      compact: true,
      progress: {
         issuesTotal: 0,
         issuesDone: 0,
         issuesCancelled: 0,
         issuesWorking: 0,
         approvalsPending: 0,
         percent: 0,
      },
   },
};

export const Done: Story = {
   args: {
      progress: {
         issuesTotal: 6,
         issuesDone: 6,
         issuesCancelled: 0,
         issuesWorking: 0,
         approvalsPending: 0,
         percent: 100,
      },
   },
};
