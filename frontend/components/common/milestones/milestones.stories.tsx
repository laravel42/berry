import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useMilestonesListStore } from '@/store/milestones-list-store';
import { useMilestonesStore } from '@/store/milestones-store';
import { seedGoalStores, seedProjectStores, storyGoals } from '../projects/stories-fixtures';
import Milestones from './milestones';

/** The rail rows: one button per goal, named by its title. */
function goalRows(canvas: { queryAllByRole: (role: 'button') => HTMLElement[] }) {
   return canvas
      .queryAllByRole('button')
      .filter((row) => storyGoals.some((goal) => row.textContent?.includes(goal.title)));
}

const meta = {
   component: Milestones,
   tags: ['ai-generated', 'needs-work'],
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: () => {
      seedProjectStores();
      seedGoalStores();
      useMilestonesListStore.setState({ query: '' });
   },
   decorators: [
      (Story) => (
         <div className="w-[900px] border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof Milestones>;

export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {
   play: async ({ canvas }) => {
      const rows = goalRows(canvas);
      await expect(rows).toHaveLength(storyGoals.length);
      // The first goal opens beside the list.
      await expect(rows[0]).toHaveAttribute('aria-current', 'true');
   },
};

export const Search: Story = {
   beforeEach: () => {
      seedProjectStores();
      seedGoalStores();
      useMilestonesListStore.setState({ query: 'zzz-no-match' });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No goal matches this search.')).toBeVisible();
      await expect(goalRows(canvas)).toHaveLength(0);
   },
};

export const Loading: Story = {
   beforeEach: () => {
      useMilestonesStore.setState({ milestones: [], loaded: false, error: null });
   },
};

export const Empty: Story = {
   beforeEach: () => {
      useMilestonesStore.setState({ milestones: [], loaded: true, error: null });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No milestones yet.')).toBeVisible();
      await expect(canvas.getByText(/Create one from a project's page/)).toBeVisible();
      await expect(goalRows(canvas)).toHaveLength(0);
   },
};

export const Failed: Story = {
   beforeEach: () => {
      useMilestonesStore.setState({
         milestones: [],
         loaded: true,
         error: 'Milestones could not be loaded. Try again in a moment.',
      });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('alert')).toHaveTextContent('Milestones could not be loaded');
   },
};
