import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useNotificationsStore } from '@/store/notifications-store';
import { useShellStore } from '@/store/shell-store';
import { inboxItems, workspaceRoute } from '../stories-fixtures';
import { ShellPersonal } from './shell-personal';

const meta = {
   component: ShellPersonal,
   tags: ['ai-generated', 'needs-work'],
   args: { orgId: 'elian' },
   parameters: { nextjs: { navigation: workspaceRoute('/elian/inbox') } },
   decorators: [
      (Story) => (
         <div className="w-[218px] bg-[var(--shell-rail)] py-2 font-mono font-light text-[var(--shell-text)]">
            <Story />
         </div>
      ),
   ],
   beforeEach: () => {
      useNotificationsStore.setState({ notifications: inboxItems, serverUnreadCount: null });
      useShellStore.setState({ chatUnread: 2 });
   },
} satisfies Meta<typeof ShellPersonal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnInbox: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('link', { name: /^Inbox/ })).toHaveAttribute(
         'aria-current',
         'page'
      );
      await expect(canvas.getByText('Inbox, 3 unread')).toBeInTheDocument();
      await expect(canvas.getByText('Chat, 2 unread')).toBeInTheDocument();
   },
};

/** Before the list loads the server's figure stands in. */
export const ServerCountOnly: Story = {
   beforeEach: () => {
      useNotificationsStore.setState({ notifications: [], serverUnreadCount: 140 });
      useShellStore.setState({ chatUnread: 0 });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('99+')).toBeInTheDocument();
      await expect(canvas.queryByText(/^Chat, /)).toBeNull();
   },
};

/** "My tasks" lights only on the assigned tab of the tasks page. */
export const OnMyTasks: Story = {
   parameters: {
      nextjs: { navigation: { ...workspaceRoute('/elian/tasks'), query: { tab: 'assigned' } } },
   },
   beforeEach: () => {
      useNotificationsStore.setState({
         notifications: inboxItems.map((item) => ({ ...item, read: true })),
      });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('link', { name: 'My tasks' })).toHaveAttribute(
         'aria-current',
         'page'
      );
   },
};
