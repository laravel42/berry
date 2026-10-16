import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { useGoalsStore } from '@/store/goals-store';
import { goalActive, seedGoalStores, seedProjectStores } from '../projects/stories-fixtures';
import { GoalTitle } from './goal-title';

const meta = {
   component: GoalTitle,
   tags: ['ai-generated', 'needs-work'],
   args: { goal: goalActive },
   decorators: [
      (Story) => (
         <div className="w-[720px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedProjectStores({ sessionReady: true });
      seedGoalStores();
      msw.use(
         http.patch('*/api/v1/goals/:id', async ({ request, params }) => {
            const body = (await request.json()) as { title?: string };
            const known = useGoalsStore.getState().getGoalById(String(params.id)) ?? goalActive;
            const updated = { ...known, ...body, updatedAt: '2026-10-16T12:00:00Z' };
            return HttpResponse.json(updated);
         })
      );
   },
} satisfies Meta<typeof GoalTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Reading: Story = {
   play: async ({ canvas }) => {
      await expect(
         canvas.getByRole('heading', { level: 1, name: goalActive.title })
      ).toBeInTheDocument();
   },
};

export const RenameWithEnter: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Edit the title' }));
      const field = canvas.getByRole('textbox', { name: 'Edit the title' });
      await userEvent.clear(field);
      await userEvent.type(field, 'Ship health that survives a reload{Enter}');
      await waitFor(() =>
         expect(useGoalsStore.getState().getGoalById(goalActive.id)?.title).toBe(
            'Ship health that survives a reload'
         )
      );
   },
};

export const EmptyTitleRefused: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Edit the title' }));
      await userEvent.clear(canvas.getByRole('textbox', { name: 'Edit the title' }));
      await userEvent.keyboard('{Enter}');
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('A goal needs a title.')).toBeVisible();
   },
};

export const SaveFails: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.patch('*/api/v1/goals/:id', () =>
            HttpResponse.json(
               { error: { code: 'INTERNAL', message: 'Boom', details: null } },
               { status: 500 }
            )
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Edit the title' }));
      await userEvent.type(canvas.getByRole('textbox', { name: 'Edit the title' }), ' now{Enter}');
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('The title could not be saved.')).toBeVisible();
      await expect(useGoalsStore.getState().getGoalById(goalActive.id)?.title).toBe(
         goalActive.title
      );
   },
};
