import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { useGoalsStore } from '@/store/goals-store';
import { goalActive, seedGoalStores, seedProjectStores } from '../projects/stories-fixtures';
import { GoalActionsMenu } from './goal-context-menu';

const meta = {
   component: GoalActionsMenu,
   tags: ['ai-generated'],
   args: { goal: goalActive },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: ({ msw }) => {
      seedProjectStores();
      seedGoalStores();
      msw.use(http.delete('*/api/v1/goals/:id', () => new HttpResponse(null, { status: 204 })));
   },
} satisfies Meta<typeof GoalActionsMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No goal loaded yet: the button is there but disabled. */
export const Collapsed: Story = {
   args: { goal: undefined },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Goal actions' })).toBeDisabled();
   },
};

/** An admin sees Remove beside the ordinary open and copy actions. */
export const OpenListsActions: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Goal actions' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('menuitem', { name: /Open in a new tab/ })).toBeVisible();
      await expect(body.getByRole('menuitem', { name: /Copy link/ })).toBeVisible();
      await expect(body.getByRole('menuitem', { name: /Remove/ })).toBeVisible();
   },
};

/** Remove asks first; confirming takes the goal off the store. */
export const RemoveConfirmed: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Goal actions' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: /Remove/ }));
      const dialog = await body.findByRole('alertdialog');
      await expect(dialog).toHaveTextContent(`Remove “${goalActive.title}”?`);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
      await waitFor(() =>
         expect(useGoalsStore.getState().getGoalById(goalActive.id)).toBeUndefined()
      );
   },
};
