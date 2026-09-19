import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { inboxItems } from '@/components/layout/stories-fixtures';
import { useNotificationsStore } from '@/store/notifications-store';
import { InboxHeader } from './inbox-header';

const meta = {
   component: InboxHeader,
   tags: ['ai-generated', 'needs-work'],
   parameters: { layout: 'fullscreen' },
   beforeEach: () => {
      useNotificationsStore.setState({ notifications: inboxItems, status: 'ready' });
   },
} satisfies Meta<typeof InboxHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithUnread: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { name: 'Inbox' })).toBeVisible();
      await expect(canvas.getByLabelText('3 unread')).toHaveTextContent('3');
   },
};

export const AllRead: Story = {
   beforeEach: () => {
      useNotificationsStore.setState({
         notifications: inboxItems.map((item) => ({ ...item, read: true })),
      });
   },
   play: async ({ canvas }) => {
      await expect(canvas.queryByLabelText(/unread/)).toBeNull();
   },
};
