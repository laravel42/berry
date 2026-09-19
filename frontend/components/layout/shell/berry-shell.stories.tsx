import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useNotificationsStore } from '@/store/notifications-store';
import { usePinsStore } from '@/store/pins-store';
import { useShellStore } from '@/store/shell-store';
import { useSidebarPrefsStore } from '@/store/sidebar-prefs-store';
import { useUiPrefsStore } from '@/store/ui-prefs-store';
import { inboxItems, seedSession, shellHandlers, workspaceRoute } from '../stories-fixtures';
import { BerryShell } from './berry-shell';

const meta = {
   component: BerryShell,
   tags: ['ai-generated', 'needs-work'],
   args: {
      children: (
         <div className="p-8 text-foreground">
            <h1>Tasks</h1>
            <p className="mt-2 text-muted-foreground">The page renders here, under the top bar.</p>
         </div>
      ),
   },
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/issue/BERR-42') },
   },
   beforeEach: ({ msw }) => {
      seedSession();
      useSidebarPrefsStore.setState(useSidebarPrefsStore.getInitialState());
      useUiPrefsStore.setState({ floatingChat: true });
      useShellStore.setState({
         railOpen: true,
         railOverlayOpen: false,
         chatWindow: 'closed',
         chatUnread: 0,
      });
      useNotificationsStore.setState({
         notifications: inboxItems,
         status: 'ready',
         arrivals: [],
         selectedNotification: undefined,
      });
      usePinsStore.setState({ pins: [], loaded: false });
      msw.use(...shellHandlers);
   },
} satisfies Meta<typeof BerryShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas }) => {
      // No tab strip: the bar holds the chat button only. Notifications live
      // on Inbox in the rail.
      await expect(canvas.queryByRole('tablist')).toBeNull();
      await expect(canvas.queryByRole('button', { name: /notifications/i })).toBeNull();
      await expect(canvas.getByRole('button', { name: /agents/i })).toBeVisible();
   },
};

/** At `lg` the rail folds to a 36px column holding its expand control. */
export const RailCollapsed: Story = {
   beforeEach: () => {
      useShellStore.setState({ railOpen: false });
   },
};

/** Settings swaps the rail's contents. */
export const Settings: Story = {
   parameters: {
      nextjs: { navigation: workspaceRoute('/elian/settings/preferences') },
   },
};

/**
 * Below `lg` the bar's menu button opens the rail over the page. The button
 * is `lg:hidden` (a viewport media query), so there is no play here: the test
 * browser is desktop-sized. Pick a mobile viewport in Storybook to try it.
 */
export const MobileMenu: Story = {
   globals: { viewport: { value: 'mobile2', isRotated: false } },
};

/** At `lg` the rail is a column; the expand control restores it when folded. */
export const CollapseAndExpandRail: Story = {
   play: async ({ canvas, userEvent }) => {
      useShellStore.setState({ railOpen: false });
      await expect(canvas.queryByRole('navigation', { name: 'Workspace' })).toBeNull();
      await userEvent.click(canvas.getByRole('button', { name: 'Expand sidebar' }));
      await expect(canvas.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
   },
};
