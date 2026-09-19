import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import type { ReviewItem } from '@/lib/reviews';
import { useNotificationsStore } from '@/store/notifications-store';
import { usePinsStore } from '@/store/pins-store';
import { useReviewsStore } from '@/store/reviews-store';
import { useShellStore } from '@/store/shell-store';
import { useSidebarPrefsStore } from '@/store/sidebar-prefs-store';
import {
   inboxItems,
   issues,
   seedSession,
   shellHandlers,
   workspaceRoute,
} from '../stories-fixtures';
import { useIssuesStore } from '@/store/issues-store';
import { ShellRail } from './shell-rail';

/**
 * Two reviews waiting. The rail only counts the queue, so the entries carry
 * just enough to be told apart.
 */
const openReviews = [{ runId: 'run-7' }, { runId: 'run-9' }] as unknown as ReviewItem[];

const meta = {
   component: ShellRail,
   tags: ['ai-generated', 'needs-work'],
   // Open as the overlay too, so the rail is on screen at every viewport width.
   args: {
      orgId: 'elian',
      active: 'issues',
      settingsMode: false,
      columnOpen: true,
      overlayOpen: true,
      onDismiss: fn(),
   },
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/tasks') },
   },
   decorators: [
      (Story) => (
         <div className="flex h-[720px] bg-[var(--shell-surface)] font-mono font-light text-[var(--shell-text)]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedSession('admin');
      useSidebarPrefsStore.setState(useSidebarPrefsStore.getInitialState());
      useShellStore.setState({ chatUnread: 0 });
      useReviewsStore.setState({ open: [] });
      useNotificationsStore.setState({ notifications: inboxItems, status: 'ready' });
      useIssuesStore.getState().hydrateIssues(issues);
      usePinsStore.setState({ pins: [], loaded: false });
      msw.use(...shellHandlers);
   },
} satisfies Meta<typeof ShellRail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Admin: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('link', { name: 'Tasks' })).toHaveAttribute(
         'aria-current',
         'page'
      );
      // Owners and admins start with Manage open.
      await expect(canvas.getByRole('button', { name: 'Manage' })).toHaveAttribute(
         'aria-expanded',
         'true'
      );
      // Pins arrive from GET /api/v1/pins.
      await expect(await canvas.findByText('Berry Server')).toBeVisible();
   },
};

/** A member starts with Manage folded, and can open it. */
export const Member: Story = {
   beforeEach: () => {
      seedSession('member');
   },
   play: async ({ canvas, userEvent }) => {
      const fold = canvas.getByRole('button', { name: 'Manage' });
      await expect(fold).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(fold);
      await expect(fold).toHaveAttribute('aria-expanded', 'true');
      await expect(canvas.getByRole('link', { name: 'Skills' })).toBeVisible();
   },
};

export const WithBadges: Story = {
   args: { active: 'reviews' },
   beforeEach: () => {
      useReviewsStore.setState({ open: openReviews });
      useShellStore.setState({ chatUnread: 4 });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('2 reviews waiting')).toBeInTheDocument();
      await expect(canvas.getByText('Inbox, 3 unread')).toBeInTheDocument();
      await expect(canvas.getByText('Chat, 4 unread')).toBeInTheDocument();
   },
};

export const WorkspaceMenu: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Workspace menu' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('menuitem', { name: 'Switch workspace' })).toBeVisible();
      await expect(body.getByRole('menuitem', { name: /Log out/ })).toBeVisible();
   },
};

/** On a settings route the rail carries the settings groups instead. */
export const Settings: Story = {
   args: { settingsMode: true, active: null },
   parameters: {
      nextjs: { navigation: workspaceRoute('/elian/settings/members') },
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('link', { name: 'Back to app' })).toBeVisible();
   },
};
