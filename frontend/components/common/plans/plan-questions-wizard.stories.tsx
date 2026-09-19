import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor, within } from 'storybook/test';
import { usePlanStore } from '@/store/plan-store';
import { blockedPlan, generatingPlan } from './plan-fixtures';
import { PlanQuestionsWizard } from './plan-questions-wizard';

const meta = {
   component: PlanQuestionsWizard,
   tags: ['ai-generated', 'needs-work'],
   args: { record: blockedPlan, open: true, onOpenChange: fn() },
   beforeEach: ({ msw }) => {
      usePlanStore.setState({ records: {}, errors: {}, busy: {} });
      // Answers 202 with the plan back in generation.
      msw.use(
         http.post('*/api/v1/plans/:id/answers', () =>
            HttpResponse.json({ ...generatingPlan, id: blockedPlan.id }, { status: 202 })
         )
      );
   },
} satisfies Meta<typeof PlanQuestionsWizard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The blocking question first; Continue waits for an answer, then the optional one can be skipped. */
export const AnswerAndReplan: Story = {
   play: async ({ args, canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('dialog');
      const scope = within(dialog);
      await expect(scope.getByText('Question 1 of 2')).toBeVisible();
      const next = scope.getByRole('button', { name: 'Continue' });
      await expect(next).toBeDisabled();

      const option = scope.getByRole('button', { name: /The project lead only/ });
      await userEvent.click(option);
      await expect(option).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(next);

      await expect(scope.getByText('Question 2 of 2 · optional')).toBeVisible();
      await userEvent.click(scope.getByRole('button', { name: 'Skip' }));

      // Skipping the last question submits: POST /answers (MSW), then close.
      await expect(await body.findByText('Planning again with your answers')).toBeVisible();
      await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
   },
};

/** A single question without options: free text is the only way to answer. */
export const FreeTextOnly: Story = {
   args: {
      record: {
         ...blockedPlan,
         plan: {
            ...blockedPlan.plan!,
            assumptions: [
               {
                  id: 'q-9',
                  description: 'Which repository should the migration land in?',
                  confidence: 'low',
                  userEditable: true,
                  blocking: true,
                  options: [],
               },
            ],
         },
      },
   },
};

export const SubmitFails: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/plans/:id/answers', () =>
            HttpResponse.json(
               { error: { code: 'PLAN_BUSY', message: 'Plan is busy', requestId: 'req-1' } },
               { status: 409 }
            )
         )
      );
   },
   args: {
      record: {
         ...blockedPlan,
         plan: { ...blockedPlan.plan!, assumptions: blockedPlan.plan!.assumptions.slice(0, 1) },
      },
   },
   play: async ({ args, canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog'));
      await userEvent.type(dialog.getByRole('textbox'), 'Leads and admins');
      await userEvent.click(dialog.getByRole('button', { name: 'Plan again' }));
      await expect(
         await body.findByText('The plan is still being worked on. Try again in a moment.')
      ).toBeVisible();
      // The dialog stays open so the answer is not lost.
      await expect(args.onOpenChange).not.toHaveBeenCalled();
      await expect(dialog.getByRole('textbox')).toHaveValue('Leads and admins');
   },
};
