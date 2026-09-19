import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { useCreatePlanStore } from '@/store/create-plan-store';
import { usePlanStore } from '@/store/plan-store';
import { useProjectsStore } from '@/store/projects-store';
import { useSessionStore } from '@/store/session-store';
import { CreatePlanDialog } from './create-plan-dialog';
import { generatingPlan, planProjects, readySession } from './plan-fixtures';

const meta = {
   component: CreatePlanDialog,
   tags: ['ai-generated', 'needs-work'],
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: ({ msw }) => {
      useSessionStore.setState(readySession);
      useProjectsStore.setState({ projects: planProjects });
      usePlanStore.setState({ records: {}, errors: {}, busy: {} });
      useCreatePlanStore.setState({ isOpen: true, prefill: {} });
      msw.use(
         http.post('*/api/v1/plans/generate', () =>
            HttpResponse.json(generatingPlan, { status: 202 })
         )
      );
   },
} satisfies Meta<typeof CreatePlanDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Type the goal, turn AutoGate on, press Plan it: the record lands in the store and the dialog closes. */
export const PlanSomething: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog'));
      const submit = dialog.getByRole('button', { name: 'Plan it' });
      await expect(submit).toBeDisabled();

      await userEvent.type(
         dialog.getByRole('textbox', { name: 'What do you want to accomplish?' }),
         'Let project leads post a weekly update'
      );
      const autoGate = dialog.getByRole('button', { name: 'AutoGate' });
      await userEvent.click(autoGate);
      await expect(autoGate).toHaveAttribute('aria-pressed', 'true');

      await userEvent.click(submit);
      await waitFor(() => expect(useCreatePlanStore.getState().isOpen).toBe(false));
      await expect(usePlanStore.getState().records[generatingPlan.id]).toBeDefined();
   },
};

/** Opened from a project page: the prompt and project arrive pre-filled. */
export const Prefilled: Story = {
   beforeEach: () => {
      useCreatePlanStore.setState({
         isOpen: true,
         prefill: {
            prompt: 'Move approvals and proposals into the inbox',
            projectId: 'project-berry',
         },
      });
   },
};

/** The server refuses: the dialog stays open and says why. */
export const Forbidden: Story = {
   beforeEach: ({ msw }) => {
      useCreatePlanStore.setState({
         isOpen: true,
         prefill: { prompt: 'Rotate the integration encryption key' },
      });
      msw.use(
         http.post('*/api/v1/plans/generate', () =>
            HttpResponse.json(
               { error: { code: 'PLAN_FORBIDDEN', message: 'Forbidden', requestId: 'req-3' } },
               { status: 403 }
            )
         )
      );
   },
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog'));
      await userEvent.click(dialog.getByRole('button', { name: 'Plan it' }));
      await expect(
         await body.findByText('Viewers cannot plan work in this workspace.')
      ).toBeVisible();
      await expect(useCreatePlanStore.getState().isOpen).toBe(true);
   },
};
