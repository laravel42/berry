import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { getRouter } from '@storybook/nextjs-vite/navigation.mock';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { readyPlan } from '@/components/common/plans/plan-fixtures';
import { usePlanStore } from '@/store/plan-store';
import { useSessionStore } from '@/store/session-store';
import { projectHealth, seedProjectStores } from '../stories-fixtures';
import { AiWorkflowButton } from './ai-workflow-button';

const meta = {
   component: AiWorkflowButton,
   args: { project: projectHealth },
   parameters: {
      nextjs: { navigation: { segments: [['orgId', 'berry']] } },
   },
   beforeEach: ({ msw }) => {
      seedProjectStores({ sessionReady: true });
      useSessionStore.setState({ boardId: 'board-1' });
      usePlanStore.setState({ records: {} });
      msw.use(
         http.get('*/api/v1/plans', () => HttpResponse.json({ nodes: [] })),
         http.post('*/api/v1/plans/generate', async ({ request }) => {
            const body = (await request.json()) as { projectId?: string; prompt: string };
            return HttpResponse.json(
               { ...readyPlan, id: 'plan-new', projectId: body.projectId ?? null },
               { status: 201 }
            );
         })
      );
   },
} satisfies Meta<typeof AiWorkflowButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The button with its moving border; the tooltip says what pressing it means. */
export const Idle: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const canvas = within(canvasElement);
      const button = canvas.getByRole('button', { name: 'AI Workflow' });
      await userEvent.hover(button);
      const body = within(canvasElement.ownerDocument.body);
      await expect(
         (await body.findAllByText(/developed with AI assistance/))[0]
      ).toBeInTheDocument();
   },
};

/** Start asks the planner for this project and goes to the plan. */
export const StartsThePlan: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(within(canvasElement).getByRole('button', { name: 'AI Workflow' }));
      const dialog = await body.findByRole('dialog');
      await expect(within(dialog).getByText('Plan approval')).toBeVisible();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Start AI workflow' }));
      await waitFor(() => expect(getRouter().push).toHaveBeenCalledWith('/berry/plan/plan-new'));
      await expect(usePlanStore.getState().records['plan-new']?.projectId).toBe(projectHealth.id);
   },
};

/** A project that already has an open plan is taken to it, not planned twice. */
export const OpenPlanExists: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/plans', () =>
            HttpResponse.json({
               nodes: [
                  {
                     id: 'plan-open',
                     status: 'draft',
                     title: projectHealth.name,
                     projectId: projectHealth.id,
                     generation: { status: 'succeeded' },
                     validationStatus: 'valid',
                     compileStatus: 'idle',
                     plannedTasks: 3,
                     createdTasks: 0,
                     finishedTasks: 0,
                     createdAt: '2026-09-18T10:00:00Z',
                     updatedAt: '2026-09-18T10:00:00Z',
                  },
               ],
            })
         ),
         http.post('*/api/v1/plans/generate', () =>
            HttpResponse.json(
               { error: { code: 'TEST', message: 'should not be called' } },
               { status: 500 }
            )
         )
      );
   },
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(within(canvasElement).getByRole('button', { name: 'AI Workflow' }));
      const dialog = await body.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Start AI workflow' }));
      await waitFor(() => expect(getRouter().push).toHaveBeenCalledWith('/berry/plan/plan-open'));
   },
};

/** The planner is not on this deployment: the dialog stays and says why. */
export const PlannerUnavailable: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/plans/generate', () =>
            HttpResponse.json(
               { error: { code: 'PLANNER_UNAVAILABLE', message: 'No planner.' } },
               { status: 503 }
            )
         )
      );
   },
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(within(canvasElement).getByRole('button', { name: 'AI Workflow' }));
      const dialog = await body.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Start AI workflow' }));
      await expect(
         await body.findByText('The planner is not available on this deployment.')
      ).toBeVisible();
      await expect(body.getByRole('dialog')).toBeVisible();
   },
};
