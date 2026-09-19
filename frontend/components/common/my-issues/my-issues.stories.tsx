import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { expect } from 'storybook/test';
import {
   discoveryIssues,
   issues,
   seedSession,
   shellHandlers,
   workspaceRoute,
} from '@/components/layout/stories-fixtures';
import { useIssuesStore } from '@/store/issues-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useSearchStore } from '@/store/search-store';
import MyIssues from './my-issues';

const DISCOVERY_DISMISSED_KEY = 'berry:discovery-notice-dismissed';

const meta = {
   component: MyIssues,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/tasks') },
   },
   decorators: [
      (Story) => (
         <div className="h-[640px] border bg-container">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedSession();
      useIssuesStore.getState().hydrateIssues(issues);
      useIssuesStore.setState({ loadState: 'ready', loadError: null });
      useRightPanelStore.setState({ openPanel: null });
      useSearchStore.setState({ isSearchOpen: false, searchQuery: '' });
      msw.use(...shellHandlers);
   },
} satisfies Meta<typeof MyIssues>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllTasks: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Persist project health')).toBeVisible();
      await expect(canvas.getByText('Share the list filter across pages')).toBeVisible();
   },
};

/** `?tab=assigned`: only what the signed-in person holds. */
export const AssignedToMe: Story = {
   decorators: [
      (Story) => (
         <NuqsTestingAdapter searchParams="?tab=assigned">
            <Story />
         </NuqsTestingAdapter>
      ),
   ],
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Persist project health')).toBeVisible();
      await expect(canvas.queryByText('Share the list filter across pages')).toBeNull();
   },
};

/** A fresh workspace: only the agents' discovery tasks, and the line explaining them. */
export const DiscoveryBacklog: Story = {
   beforeEach: () => {
      try {
         window.localStorage.removeItem(DISCOVERY_DISMISSED_KEY);
      } catch {
         /* Storage may be unavailable; the notice then stays hidden. */
      }
      useIssuesStore.getState().hydrateIssues(discoveryIssues);
   },
   play: async ({ canvas, userEvent }) => {
      const notice = await canvas.findByRole('status');
      await expect(notice).toHaveTextContent('discovery tasks');
      await userEvent.click(canvas.getByRole('button', { name: 'Dismiss' }));
      await expect(canvas.queryByRole('status')).toBeNull();
   },
};

export const Loading: Story = {
   beforeEach: () => {
      useIssuesStore.getState().hydrateIssues([]);
      useIssuesStore.setState({ loadState: 'loading' });
   },
};

export const LoadFailed: Story = {
   beforeEach: () => {
      useIssuesStore.getState().hydrateIssues([]);
      useIssuesStore.setState({ loadState: 'error', loadError: '' });
   },
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.getByText('Those tasks could not be loaded.')).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
      await expect(useIssuesStore.getState().loadState).toBe('loading');
   },
};
