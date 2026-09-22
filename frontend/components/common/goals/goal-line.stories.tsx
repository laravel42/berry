import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent } from 'storybook/test';
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
   args: { goal: goalActive, selected: false, onSelect: fn() },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: () => {
      seedProjectStores();
   },
   decorators: [
      (Story) => (
         <div className="w-[440px] border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof GoalLine>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A goal inside a project shows the project name as its subtitle. */
export const InProject: Story = {
   play: async ({ canvas, args }) => {
      await expect(canvas.getByText(projectHealth.name)).toBeVisible();
      await userEvent.click(canvas.getByRole('button'));
      await expect(args.onSelect).toHaveBeenCalledWith(goalActive.id);
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
