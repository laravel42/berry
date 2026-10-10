import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useGoalsListStore } from '@/store/goals-list-store';
import { useGoalsStore } from '@/store/goals-store';
import { seedGoalStores, seedProjectStores, storyGoals } from '../projects/stories-fixtures';
import Goals from './goals';

/** The rail rows: one button per goal, named by its title. */
function goalRows(canvas: { queryAllByRole: (role: 'button') => HTMLElement[] }) {
   return canvas
      .queryAllByRole('button')
      .filter((row) => storyGoals.some((goal) => row.textContent?.includes(goal.title)));
}

const meta = {
   component: Goals,
   tags: ['ai-generated', 'needs-work'],
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: () => {
      seedProjectStores();
      seedGoalStores();
      useGoalsListStore.setState({ query: '' });
   },
   decorators: [
      (Story) => (
         <div className="w-[900px] border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof Goals>;

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
      useGoalsListStore.setState({ query: 'zzz-no-match' });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No goal matches this search.')).toBeVisible();
      await expect(goalRows(canvas)).toHaveLength(0);
   },
};

export const Loading: Story = {
   beforeEach: () => {
      useGoalsStore.setState({ goals: [], loaded: false, error: null });
   },
};

export const Empty: Story = {
   beforeEach: () => {
      useGoalsStore.setState({ goals: [], loaded: true, error: null });
   },
   play: async ({ canvas }) => {
      // The empty state explains that planning in a project makes goals.
      await expect(canvas.getByText('No goals yet.')).toBeVisible();
      await expect(canvas.getByText(/Plan work in a project/)).toBeVisible();
      await expect(goalRows(canvas)).toHaveLength(0);
   },
};

export const Failed: Story = {
   beforeEach: () => {
      useGoalsStore.setState({
         goals: [],
         loaded: true,
         error: 'Goals could not be loaded. Try again in a moment.',
      });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('alert')).toHaveTextContent('Goals could not be loaded');
   },
};
