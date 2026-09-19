import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { expect } from 'storybook/test';
import { useIssuesStore } from '@/store/issues-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useSearchStore } from '@/store/search-store';
import {
   issues,
   me,
   seedSession,
   shellHandlers,
   teammate,
   workspaceRoute,
} from '../../stories-fixtures';
import Header from './header';

const meta = {
   component: Header,
   tags: ['ai-generated', 'needs-work'],
   args: { member: me },
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/profiles/user-1', [['profileId', 'user-1']]) },
   },
   decorators: [
      (Story) => (
         <div className="flex w-full flex-col">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedSession();
      useIssuesStore.getState().hydrateIssues(issues);
      useRightPanelStore.setState({ openPanel: 'hidden' });
      useSearchStore.setState({ isSearchOpen: false, searchQuery: '' });
      msw.use(...shellHandlers);
   },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Elian holds two of the four tasks. */
export const Assigned: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Assigned' })).toHaveAttribute(
         'aria-current',
         'page'
      );
      await expect(canvas.getByText('2 issues')).toBeInTheDocument();
   },
};

export const Created: Story = {
   args: { member: teammate },
   decorators: [
      (Story) => (
         <NuqsTestingAdapter searchParams="?tab=created">
            <Story />
         </NuqsTestingAdapter>
      ),
   ],
};

export const Searching: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Search' }));
      const input = canvas.getByPlaceholderText('Search tasks...');
      await expect(input).toHaveFocus();
      await userEvent.type(input, 'health');
      await expect(useSearchStore.getState().searchQuery).toBe('health');
   },
};
