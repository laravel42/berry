import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { useNotificationsDrawerStore } from '@/store/notifications-drawer-store';
import { useNotificationsStore } from '@/store/notifications-store';
import { usePinsStore } from '@/store/pins-store';
import { useShellStore } from '@/store/shell-store';
import { useSidebarPrefsStore } from '@/store/sidebar-prefs-store';
import { useUiPrefsStore } from '@/store/ui-prefs-store';
import {
   inboxItems,
   seedSession,
   shellHandlers,
   shellTabs,
   workspaceRoute,
} from '../stories-fixtures';
import { BerryShell } from './berry-shell';

const meta = {
   component: BerryShell,
   tags: ['ai-generated', 'needs-work'],
   args: {
      children: (
         <div className="p-8 text-foreground">
            <h1>Tasks</h1>
            <p className="mt-2 text-muted-foreground">
               The page renders here, under the tab strip.
            </p>
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
         tabs: shellTabs,
         activeTabId: 'tab-2',
         railOpen: true,
         railOverlayOpen: false,
         chatWindow: 'closed',
         chatUnread: 0,
      });
      useNotificationsDrawerStore.setState({ isOpen: false });
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
   play: async ({ canvas, canvasElement, userEvent }) => {
      await expect(canvas.getByRole('tablist', { name: 'Open views' })).toBeVisible();
      // The bell opens the notifications drawer beside the page.
      await userEvent.click(canvas.getByRole('button', { name: 'Notifications, 3 unread' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('dialog', { name: 'Notifications' })).toBeVisible();
   },
};

/** At `lg` the rail folds to a 36px column holding its expand control. */
export const RailCollapsed: Story = {
   beforeEach: () => {
      useShellStore.setState({ railOpen: false });
   },
};

/** Settings swaps the rail's contents and selects no tab. */
export const Settings: Story = {
   parameters: {
      nextjs: { navigation: workspaceRoute('/elian/settings/preferences') },
   },
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('tab', { selected: true })).toBeNull();
   },
};

/**
 * Below `lg` the strip's menu button opens the rail over the page. The button
 * is `lg:hidden` (a viewport media query), so there is no play here: the test
 * browser is desktop-sized. Pick a mobile viewport in Storybook to try it.
 */
export const MobileMenu: Story = {
   globals: { viewport: { value: 'mobile2', isRotated: false } },
};

/** At `lg` the rail is a column that folds to its expand control and back. */
export const CollapseAndExpandRail: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Collapse sidebar' }));
      await expect(useShellStore.getState().railOpen).toBe(false);
      await expect(canvas.queryByRole('navigation', { name: 'Workspace' })).toBeNull();
      await userEvent.click(canvas.getByRole('button', { name: 'Expand sidebar' }));
      await expect(canvas.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
   },
};
