import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { MilestoneStatusBadge } from './milestone-status-badge';

const meta = {
   component: MilestoneStatusBadge,
   tags: ['ai-generated', 'needs-work'],
   args: { status: 'active' },
   argTypes: {
      status: {
         control: 'select',
         options: ['planned', 'active', 'blocked', 'completed'],
      },
   },
} satisfies Meta<typeof MilestoneStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {};
export const Planned: Story = { args: { status: 'planned' } };
export const Blocked: Story = { args: { status: 'blocked' } };
export const Completed: Story = { args: { status: 'completed' } };
