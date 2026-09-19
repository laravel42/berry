import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { GoalProgress } from './goal-progress';

const meta = {
   component: GoalProgress,
   tags: ['ai-generated', 'needs-work'],
   args: {
      progress: { issuesTotal: 5, issuesDone: 3, issuesCancelled: 0, approvalsPending: 2 },
   },
   decorators: [
      (Story) => (
         <div className="w-[480px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof GoalProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The goal page header: percentage, counts and pending approvals. */
export const Full: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('60% done')).toBeVisible();
      await expect(canvas.getByText('3 of 5 tasks done · 2 approvals pending')).toBeVisible();
   },
};

/** A goals list row: bar and done/total only. */
export const Compact: Story = {
   args: { compact: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('3/5')).toBeVisible();
   },
};

/** A row for a goal with no tasks shows a dash rather than an empty bar. */
export const CompactNoTasks: Story = {
   args: {
      compact: true,
      progress: { issuesTotal: 0, issuesDone: 0, issuesCancelled: 0, approvalsPending: 0 },
   },
};

export const Done: Story = {
   args: { progress: { issuesTotal: 6, issuesDone: 6, issuesCancelled: 0, approvalsPending: 0 } },
};
