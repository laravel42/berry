import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useRunsStore } from '@/store/runs-store';
import { IssueFilterBar } from './issue-filter-bar';
import { deliveredRun, seedIssuesWorkspace } from './stories-fixtures';
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

export const NoFiltersAgentsWorking: Story = {
   play: async ({ canvas }) => {
      // Without filters the row carries only the "agents at work" chip.
      await expect(canvas.getByRole('button', { name: /2 agents/ })).toBeInTheDocument();
      await expect(canvas.queryByRole('button', { name: 'Clear' })).toBeNull();
   },
};

export const NothingToShow: Story = {
   beforeEach: () => {
      useRunsStore.setState({ runs: [deliveredRun] });
   },
};

export const PriorityFilter: Story = {
   decorators: [withUrlFilters(urgentOnly)],
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
   },
};

export const AgentFilterFromChip: Story = {
   decorators: [withUrlFilters(frontendAgentsOnly)],
   play: async ({ canvas }) => {
      // The chip reads the same filter it would have applied, so it shows pressed.
      await expect(canvas.getByRole('button', { name: /2 agents/ })).toHaveAttribute(
         'aria-pressed',
         'true'
      );
   },
};

export const ActionsInHeader: Story = {
   args: { showActions: false },
   decorators: [withUrlFilters(urgentOnly)],
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('button', { name: 'Clear' })).toBeNull();
   },
};
