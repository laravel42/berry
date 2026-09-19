import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { APPROVAL_STATUS, GOAL_STATUS, statusLook } from '@/lib/catalog';
import { StatusBadge } from './status-badge';

const meta = {
   component: StatusBadge,
   tags: ['ai-generated', 'needs-work'],
   args: { look: GOAL_STATUS.active! },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GoalInProgress: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('In Progress')).toBeVisible();
   },
};

export const GoalBlocked: Story = { args: { look: GOAL_STATUS.blocked! } };
export const ApprovalRejected: Story = { args: { look: APPROVAL_STATUS.rejected! } };

/** A status the catalogue does not know falls back to its raw value on a hollow mark. */
export const UnknownStatus: Story = {
   args: { look: statusLook(APPROVAL_STATUS, 'superseded') },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('superseded')).toBeVisible();
   },
};

export const AllGoalStates: Story = {
   render: () => (
      <div className="flex flex-wrap gap-2">
         {Object.entries(GOAL_STATUS).map(([key, look]) => (
            <StatusBadge key={key} look={look} />
         ))}
      </div>
   ),
};
