import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useIssueSelectionStore } from '@/store/issue-selection-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useSearchStore } from '@/store/search-store';
import AllIssues from './all-issues';
import { issueApiHandlers, seedIssuesWorkspace } from './stories-fixtures';
import { urgentOnly, withUrlFilters } from './stories-filters';

const meta = {
   component: AllIssues,
   tags: ['ai-generated', 'needs-work'],
   decorators: [
      (Story) => (
         <div className="h-[720px] w-[1280px] overflow-hidden border bg-background">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace();
      useSearchStore.setState({ isSearchOpen: false, searchQuery: '' });
      msw.use(...issueApiHandlers);
   },
} satisfies Meta<typeof AllIssues>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllTasksList: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Persist project health and updates')).toBeInTheDocument();
      await expect(canvas.getByText('Drop the OpenRouter fallback')).toBeInTheDocument();
   },
};

export const ActiveTab: Story = {
   args: { categories: ['started', 'unstarted'] },
   play: async ({ canvas }) => {
      // The Active tab leaves out the backlog and everything finished.
      await expect(canvas.queryByText('Drop the OpenRouter fallback')).toBeNull();
      await expect(canvas.queryByText('Cover health updates with DB-backed tests')).toBeNull();
   },
};

export const Board: Story = { decorators: [withUrlFilters([], { layout: 'grid' })] };
export const Table: Story = { decorators: [withUrlFilters([], { layout: 'table' })] };
export const Timeline: Story = { decorators: [withUrlFilters([], { layout: 'gantt' })] };

export const FilteredWithInsights: Story = {
   decorators: [withUrlFilters(urgentOnly)],
   beforeEach: () => {
      useRightPanelStore.setState({ openPanel: 'insights' });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('6 tasks hidden by filters')).toBeInTheDocument();
   },
};

export const WithSelection: Story = {
   beforeEach: () => {
      useIssueSelectionStore.setState({ selected: ['issue-42', 'issue-46'], anchor: 'issue-46' });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('2 selected')).toBeInTheDocument();
   },
};

export const Searching: Story = {
   beforeEach: () => {
      useSearchStore.setState({ isSearchOpen: true, searchQuery: 'inbox' });
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Results (1)')).toBeInTheDocument();
   },
};
