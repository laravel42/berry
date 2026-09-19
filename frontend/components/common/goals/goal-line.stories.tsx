import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import {
   goalActive,
   goalBlocked,
   goalCompleted,
   goalPlanned,
   projectHealth,
   seedProjectStores,
} from '../projects/stories-fixtures';
import GoalLine from './goal-line';

const meta = {
   component: GoalLine,
   tags: ['ai-generated', 'needs-work'],
   args: { goal: goalActive },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: () => {
      seedProjectStores();
   },
   decorators: [
      (Story) => (
         <div className="w-[860px] border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof GoalLine>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A goal inside a project shows the project name as its subtitle. */
export const InProject: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText(projectHealth.name)).toBeVisible();
      await expect(canvas.getByRole('link')).toHaveAttribute(
         'href',
         `/berry/goal/${goalActive.id}/overview`
      );
   },
};

export const Blocked: Story = { args: { goal: goalBlocked } };

/** No project: the description stands in. */
export const WithoutProject: Story = {
   args: { goal: goalPlanned },
   play: async ({ canvas }) => {
      await expect(canvas.getByText(goalPlanned.description!)).toBeVisible();
   },
};

export const Completed: Story = { args: { goal: goalCompleted } };
