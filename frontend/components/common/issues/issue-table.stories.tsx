import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { status as allStatus } from '@/data/status';
import { useIssueSelectionStore } from '@/store/issue-selection-store';
import { IssueTable } from './issue-table';
import { issueApiHandlers, seedIssuesWorkspace, storyIssues } from './stories-fixtures';
import { urgentOnly, withUrlFilters } from './stories-filters';

const meta = {
   component: IssueTable,
   tags: ['ai-generated', 'needs-work'],
   args: { issues: storyIssues, statuses: allStatus, totalIssues: storyIssues },
   decorators: [
      (Story) => (
         <div className="flex h-[640px] w-[1200px] flex-col overflow-hidden border bg-container">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace({ layout: 'table' });
      try {
         // The column layout is the reader's and kept in their browser.
         window.localStorage.removeItem('berry.issue-table.columns-v2');
      } catch {
         // Storage may be unavailable; the defaults apply either way.
      }
      msw.use(...issueApiHandlers);
   },
} satisfies Meta<typeof IssueTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GroupedByStatus: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Persist project health and updates')).toBeInTheDocument();
   },
};

export const Ungrouped: Story = {
   decorators: [withUrlFilters([], { group: 'none' })],
};

export const GroupedByAssignee: Story = {
   decorators: [withUrlFilters([], { group: 'assignee' })],
};

export const WithSelection: Story = {
   beforeEach: () => {
      useIssueSelectionStore.setState({ selected: ['issue-42', 'issue-44'], anchor: 'issue-44' });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Persist project health and updates')).toBeInTheDocument();
   },
};

export const Loading: Story = { args: { loading: true } };

export const FilteredToNothing: Story = {
   args: { issues: [] },
   decorators: [withUrlFilters(urgentOnly)],
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No task matches these filters.')).toBeInTheDocument();
   },
};
