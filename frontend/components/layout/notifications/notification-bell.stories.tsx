import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useNotificationsDrawerStore } from '@/store/notifications-drawer-store';
import { useNotificationsStore } from '@/store/notifications-store';
import { inboxItems } from '../stories-fixtures';
import { NotificationBell } from './notification-bell';

const meta = {
   component: NotificationBell,
   tags: ['ai-generated', 'needs-work'],
   decorators: [
      (Story) => (
         <div className="flex h-[34px] w-32 items-stretch justify-end bg-[var(--shell-rail)] px-2 text-[var(--shell-text)]">
            <Story />
         </div>
      ),
   ],
   beforeEach: () => {
      useNotificationsDrawerStore.setState({ isOpen: false });
      useNotificationsStore.setState({ notifications: inboxItems, serverUnreadCount: null });
   },
} satisfies Meta<typeof NotificationBell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unread: Story = {
   play: async ({ canvas, userEvent }) => {
      const bell = canvas.getByRole('button', { name: 'Notifications, 3 unread' });
      await expect(bell).toHaveTextContent('3');
      await userEvent.click(bell);
      await expect(useNotificationsDrawerStore.getState().isOpen).toBe(true);
      await expect(bell).toHaveAttribute('aria-expanded', 'true');
   },
};

/** Past nine the badge is a dot: the figure has stopped being information. */
export const ManyUnread: Story = {
   beforeEach: () => {
      useNotificationsStore.setState({ notifications: [], serverUnreadCount: 27 });
   },
   play: async ({ canvas }) => {
      const bell = canvas.getByRole('button', { name: 'Notifications, 27 unread' });
      await expect(bell).not.toHaveTextContent('27');
   },
};

export const AllRead: Story = {
   beforeEach: () => {
      useNotificationsStore.setState({
         notifications: inboxItems.map((item) => ({ ...item, read: true })),
      });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Notifications' })).toBeVisible();
   },
};
