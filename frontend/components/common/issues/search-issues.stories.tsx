import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useSearchStore } from '@/store/search-store';
import { SearchIssues } from './search-issues';
import { seedIssuesWorkspace } from './stories-fixtures';

const meta = {
   component: SearchIssues,
   tags: ['ai-generated', 'needs-work'],
   decorators: [
      (Story) => (
         <div className="w-[760px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: () => {
      seedIssuesWorkspace();
      useSearchStore.setState({ isSearchOpen: true, searchQuery: 'health' });
   },
} satisfies Meta<typeof SearchIssues>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Results: Story = {
   play: async ({ canvas }) => {
      // "health" is in two titles: the persistence task and its test sub-task.
      await expect(await canvas.findByText('Results (2)')).toBeInTheDocument();
      await expect(canvas.getByText('Persist project health and updates')).toBeInTheDocument();
   },
};

export const ByIdentifier: Story = {
   beforeEach: () => {
      useSearchStore.setState({ isSearchOpen: true, searchQuery: 'berr-44' });
   },
};

export const NoResults: Story = {
   beforeEach: () => {
      useSearchStore.setState({ isSearchOpen: true, searchQuery: 'kubernetes' });
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('No results found for "kubernetes"')
      ).toBeInTheDocument();
   },
};

export const SearchClosed: Story = {
   beforeEach: () => {
      useSearchStore.setState({ isSearchOpen: false, searchQuery: 'health' });
   },
   play: async ({ canvasElement }) => {
      await expect(canvasElement.textContent).not.toContain('Results');
   },
};
