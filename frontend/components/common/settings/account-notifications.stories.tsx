import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { useSessionStore } from '@/store/session-store';
import AccountNotifications from './account-notifications';
import { apiError, notificationSwitches, seedSession } from './stories-fixtures';

const meta = {
   component: AccountNotifications,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(
         http.get('*/api/v1/me/notifications', () => HttpResponse.json(notificationSwitches)),
         http.patch('*/api/v1/me/notifications', async ({ request }) => {
            const body = (await request.json()) as { inApp: Record<string, boolean> };
            return HttpResponse.json({
               ...notificationSwitches,
               inApp: { ...notificationSwitches.inApp, ...body.inApp },
            });
         })
      );
   },
} satisfies Meta<typeof AccountNotifications>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.getByText(/What Berry tells you about in Elian/)).toBeVisible();
      const switches = canvas.getAllByRole('switch');
      // "Comments" (third row) is off in the fixture; wait for the load to land.
      await waitFor(() => expect(switches[2]).toHaveAttribute('aria-checked', 'false'));
      await userEvent.click(switches[2]!);
      await waitFor(() => expect(switches[2]).toHaveAttribute('aria-checked', 'true'));
   },
};

export const SaveRejected: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.patch('*/api/v1/me/notifications', () =>
            apiError(403, 'You cannot change notifications here.', 'FORBIDDEN')
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      const switches = canvas.getAllByRole('switch');
      // Switches read "on" while loading but stay disabled until the GET lands.
      await waitFor(() => expect(switches[0]).toBeEnabled());
      await expect(switches[0]).toHaveAttribute('aria-checked', 'true');
      await userEvent.click(switches[0]!);
      // The switch rolls back and the refusal is toasted.
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('You cannot change notifications here.')).toBeVisible();
      await waitFor(() => expect(switches[0]).toHaveAttribute('aria-checked', 'true'));
   },
};

export const NoWorkspace: Story = {
   beforeEach: () => {
      useSessionStore.setState({ workspace: null, workspaces: [] });
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/me/notifications', () =>
            apiError(500, 'Notification settings failed to load.')
         )
      );
   },
};
