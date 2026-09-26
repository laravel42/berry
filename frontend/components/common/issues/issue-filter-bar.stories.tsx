import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { IssueFilterBar } from './issue-filter-bar';
import { seedIssuesWorkspace } from './stories-fixtures';
import { frontendAgentsOnly, urgentOnly, withUrlFilters } from './stories-filters';

const meta = {
   component: IssueFilterBar,
   tags: ['ai-generated', 'needs-work'],
   args: { showActions: true },
   decorators: [
      (Story) => (
         <div className="w-[900px] border">
            <Story />
         </div>
      ),
   ],
   beforeEach: () => {
      seedIssuesWorkspace();
   },
} satisfies Meta<typeof IssueFilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Without filters the row is not rendered at all: the "agents at work" chip
 * that used to sit here was removed, so there is nothing left to show.
 */
export const NoFilters: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('button')).toBeNull();
      await expect(canvas.queryByText('Assignee')).toBeNull();
   },
};

export const PriorityFilter: Story = {
   decorators: [withUrlFilters(urgentOnly)],
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
   },
};

/** An assignee filter naming two agents reads back as one chip for both. */
export const AgentFilter: Story = {
   decorators: [withUrlFilters(frontendAgentsOnly)],
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Assignee')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'is any of' })).toBeVisible();
      await expect(canvas.getByRole('button', { name: /2 assignees/ })).toBeVisible();
      await expect(canvas.getByRole('img', { name: 'Frontend Engineer, agent' })).toBeVisible();
      await expect(canvas.getByRole('img', { name: 'Backend Engineer, agent' })).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Clear' })).toBeVisible();
   },
};

export const ActionsInHeader: Story = {
   args: { showActions: false },
   decorators: [withUrlFilters(urgentOnly)],
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('button', { name: 'Clear' })).toBeNull();
   },
};
