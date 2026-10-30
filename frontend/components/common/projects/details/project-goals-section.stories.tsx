import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { orgParams } from '@/components/common/agents/stories-fixtures';
import { useCreateGoalStore } from '@/store/create-goal-store';
import {
   goalActive,
   projectBilling,
   projectHealth,
   seedGoalStores,
   seedProjectStores,
} from '../stories-fixtures';
import { ProjectGoalsSection } from './project-goals-section';

const meta = {
   component: ProjectGoalsSection,
   tags: ['ai-generated'],
   args: { projectId: projectHealth.id },
   parameters: orgParams,
   beforeEach: () => {
      seedProjectStores();
      seedGoalStores();
      useCreateGoalStore.setState({ isOpen: false, prefill: {} });
   },
} satisfies Meta<typeof ProjectGoalsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The project's own goals, each with its status and progress. */
export const WithGoals: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Goals')).toBeVisible();
      await expect(canvas.getByText(goalActive.title)).toBeVisible();
   },
};

/** Always drawn, even with none, so New goal stays offered. */
export const NoGoalsYet: Story = {
   args: { projectId: projectBilling.id },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No goals in this project yet.')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'New goal' })).toBeVisible();
   },
};

/** New goal opens the create-goal dialog pre-filled and locked to this project. */
export const NewGoalOpensModal: Story = {
   args: { projectId: projectBilling.id },
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'New goal' }));
      await expect(useCreateGoalStore.getState()).toMatchObject({
         isOpen: true,
         prefill: { projectId: projectBilling.id, lockProject: true },
      });
   },
};
