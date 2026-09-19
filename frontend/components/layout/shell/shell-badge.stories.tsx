import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { ShellBadge } from './shell-badge';

const meta = {
   component: ShellBadge,
   tags: ['ai-generated'],
   args: { count: 3, label: '3 unread' },
   decorators: [
      (Story) => (
         <div className="flex w-48 items-center">
            <span>Inbox</span>
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ShellBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Few: Story = {};

export const Capped: Story = {
   args: { count: 240, label: '240 unread' },
   play: async ({ canvas }) => {
      // Past 99 the figure caps; the spoken label keeps the real count.
      await expect(canvas.getByText('99+')).toBeInTheDocument();
      await expect(canvas.getByText('240 unread')).toBeInTheDocument();
   },
};

export const Zero: Story = {
   args: { count: 0, label: 'Nothing unread' },
   play: async ({ canvas }) => {
      await expect(canvas.queryByText('Nothing unread')).toBeNull();
   },
};
