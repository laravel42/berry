import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useGoalsStore } from '@/store/goals-store';
import { seedGoalStores, seedProjectStores, storyGoals } from '../projects/stories-fixtures';
import Goals from './goals';

const meta = {
   component: Goals,
   tags: ['ai-generated', 'needs-work'],
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: () => {
      seedProjectStores();
      seedGoalStores();
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
      await expect(canvas.getAllByRole('link')).toHaveLength(storyGoals.length);
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
      // The empty state sends people to projects, where planning makes goals.
      await expect(canvas.getByRole('link')).toHaveAttribute('href', '/berry/projects');
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
