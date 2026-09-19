import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, waitFor, within } from 'storybook/test';
import { useNotificationsStore } from '@/store/notifications-store';
import { inboxItems, workspaceRoute } from '../stories-fixtures';
import { NotificationToasts } from './notification-toasts';

/**
 * Renders nothing itself: it turns the store's `arrivals` into toasts on the
 * preview's Toaster, so each story seeds arrivals and looks for the toasts.
 */
const meta = {
   component: NotificationToasts,
   tags: ['ai-generated', 'needs-work'],
   parameters: { nextjs: { navigation: workspaceRoute('/elian/tasks') } },
   beforeEach: () => {
      useNotificationsStore.setState({ arrivals: [inboxItems[0]] });
   },
} satisfies Meta<typeof NotificationToasts>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneArrival: Story = {
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Mara assigned this task to you.')).toBeVisible();
      const toast = body.getByText('Mara assigned this task to you.').closest('li');
      if (!toast) throw new Error('The toast is not in a list item');
      await expect(within(toast).getByRole('button', { name: 'Open' })).toBeVisible();
      // Announced once: the store's arrivals are cleared after toasting.
      await waitFor(() => expect(useNotificationsStore.getState().arrivals).toHaveLength(0));
   },
};

/** A burst is capped at three, with one more toast for the rest. */
export const Burst: Story = {
   beforeEach: () => {
      useNotificationsStore.setState({ arrivals: inboxItems.slice(0, 5) });
   },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      const overflow = await body.findByText('and 2 more');
      await expect(overflow).toBeVisible();
      const toast = overflow.closest('li');
      if (!toast) throw new Error('The overflow toast is not in a list item');
      await expect(within(toast).getByRole('button', { name: 'Open' })).toBeVisible();
   },
};
