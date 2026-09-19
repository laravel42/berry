import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { useNotificationsDrawerStore } from '@/store/notifications-drawer-store';
import { useNotificationsStore } from '@/store/notifications-store';
import { inboxItems, seedSession, shellHandlers, workspaceRoute } from '../stories-fixtures';
import { NotificationsDrawer } from './notifications-drawer';

const meta = {
   component: NotificationsDrawer,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/tasks') },
   },
   beforeEach: ({ msw }) => {
      seedSession();
      useNotificationsDrawerStore.setState({ isOpen: true });
      useNotificationsStore.setState({
         notifications: inboxItems,
         selectedNotification: undefined,
      });
      msw.use(...shellHandlers);
   },
} satisfies Meta<typeof NotificationsDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      const drawer = await body.findByRole('dialog', { name: 'Notifications' });
      // Unread first, then newest: the assignment from ten minutes ago leads.
      const rows = within(drawer).getAllByRole('button', { name: /ago/ });
      await expect(rows[0]).toHaveTextContent('Share the list filter across pages');
      await expect(within(drawer).getByRole('link', { name: 'Open the inbox' })).toHaveAttribute(
         'href',
         '/elian/inbox'
      );
   },
};

/** Opening a notification reads it and goes to what it is about. */
export const OpenANotification: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const drawer = await body.findByRole('dialog', { name: 'Notifications' });
      await userEvent.click(within(drawer).getByRole('button', { name: /^BERR-42/ }));
      await expect(
         useNotificationsStore.getState().notifications.find((item) => item.id === 'n-2')?.read
      ).toBe(true);
      await expect(useNotificationsDrawerStore.getState().isOpen).toBe(false);
   },
};

export const Empty: Story = {
   beforeEach: () => {
      useNotificationsStore.setState({ notifications: [] });
   },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Nothing waiting for you.')).toBeVisible();
   },
};
