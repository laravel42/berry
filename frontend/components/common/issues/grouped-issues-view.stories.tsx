import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { status as allStatus } from '@/data/status';
import { useDisplaySettingsStore } from '@/store/display-settings-store';
import { GroupedIssuesView } from './grouped-issues-view';
import {
   issueApiHandlers,
   rotateKey,
   seedIssuesWorkspace,
   sharedFilter,
   storyIssues,
} from './stories-fixtures';
import { urgentOnly, withUrlFilters } from './stories-filters';

const urgent = storyIssues.filter((issue) => issue.priority.id === 'urgent');

const meta = {
   component: GroupedIssuesView,
   tags: ['ai-generated', 'needs-work'],
   args: {
      issues: storyIssues,
      totalIssues: storyIssues,
      statuses: allStatus,
      isViewTypeGrid: false,
   },
   decorators: [
      (Story) => (
         <div className="h-[640px] w-[1100px] overflow-hidden border bg-background">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace();
      msw.use(...issueApiHandlers);
   },
} satisfies Meta<typeof GroupedIssuesView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ListByStatus: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: /In Progress\s*1/ })).toBeInTheDocument();
      await expect(canvas.getByText(sharedFilter.title)).toBeInTheDocument();
   },
};

export const ListByAssignee: Story = {
   decorators: [withUrlFilters([], { group: 'assignee' })],
};

export const ListByPriority: Story = {
   decorators: [withUrlFilters([], { group: 'priority' })],
};

export const HideCompleted: Story = {
   beforeEach: () => {
      useDisplaySettingsStore.setState({ completedIssues: 'none' });
   },
   play: async ({ canvas }) => {
      await expect(canvas.queryByText('Tighten task, review and display surfaces')).toBeNull();
   },
};

export const Board: Story = {
   args: { isViewTypeGrid: true },
   decorators: [withUrlFilters([], { layout: 'grid' })],
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Hide Blocked' })).toBeInTheDocument();
      await expect(
         canvas.getByRole('heading', { level: 4, name: rotateKey.title })
      ).toBeInTheDocument();
   },
};

export const BoardWithHiddenColumns: Story = {
   args: { isViewTypeGrid: true },
   decorators: [withUrlFilters([], { layout: 'grid' })],
   beforeEach: () => {
      useDisplaySettingsStore.setState({ hiddenBoardColumns: ['cancelled', 'done'] });
   },
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.getByText('Hidden columns')).toBeInTheDocument();
      await userEvent.click(canvas.getByRole('button', { name: 'Restore all' }));
      await expect(useDisplaySettingsStore.getState().hiddenBoardColumns).toEqual([]);
   },
};

export const FilteredWithHiddenCount: Story = {
   args: { issues: urgent },
   decorators: [withUrlFilters(urgentOnly)],
   play: async ({ canvas }) => {
      await expect(canvas.getByText('6 tasks hidden by filters')).toBeInTheDocument();
   },
};

export const FilteredToNothing: Story = {
   args: { issues: [] },
   decorators: [withUrlFilters(urgentOnly)],
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No task matches these filters.')).toBeInTheDocument();
   },
};

export const EmptyWorkspace: Story = {
   args: { issues: [], totalIssues: [] },
   beforeEach: () => {
      seedIssuesWorkspace({ issues: [], runs: [] });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No tasks yet.')).toBeInTheDocument();
   },
};
