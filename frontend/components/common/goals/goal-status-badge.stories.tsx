import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { GoalStatusBadge } from './goal-status-badge';

const meta = {
   component: GoalStatusBadge,
   tags: ['ai-generated', 'needs-work'],
   args: { status: 'active' },
} satisfies Meta<typeof GoalStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {};
export const Planned: Story = { args: { status: 'planned' } };
export const Blocked: Story = { args: { status: 'blocked' } };
export const Completed: Story = { args: { status: 'completed' } };
