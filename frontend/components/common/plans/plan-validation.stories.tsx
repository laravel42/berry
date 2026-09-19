import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { useCreatePlanStore } from '@/store/create-plan-store';
import { usePlanStore } from '@/store/plan-store';
import { blockedPlan, failedPlan, generatingPlan, invalidPlan, readyPlan } from './plan-fixtures';
import {
   PlanBlockedQuestions,
   PlanFindings,
   PlanGenerationFailure,
   PlanGenerationProgress,
} from './plan-validation';

const meta = {
   component: PlanFindings,
   tags: ['ai-generated', 'needs-work'],
   args: { record: invalidPlan },
   beforeEach: () => {
      usePlanStore.setState({ autoStart: {} });
      useCreatePlanStore.setState({ isOpen: false, prefill: {} });
   },
   decorators: [
      (Story) => (
         <div className="max-w-3xl">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof PlanFindings>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One error that stops Start Plan, plus the critic's advice as a warning. */
export const ProblemsAndWarnings: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('1 problem to fix')).toBeVisible();
      // The pointer is translated into the task it names.
      await expect(
         canvas.getByText(/Task "Expose PATCH \/api\/v1\/projects\/\{id\}\/health"/)
      ).toBeVisible();
   },
};

export const WarningsOnly: Story = { args: { record: readyPlan } };

export const GenerationProgress: Story = {
   render: () => <PlanGenerationProgress record={generatingPlan} />,
   play: async ({ canvas }) => {
      await expect(canvas.getByText('validate').closest('li')).toHaveAttribute(
         'aria-current',
         'step'
      );
   },
};

export const GenerationFailed: Story = {
   render: () => <PlanGenerationFailure record={failedPlan} />,
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.getByText('Planning timed out while planning.')).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'Plan again' }));
      // "Plan again" reopens the prompt with what was asked the first time.
      await expect(useCreatePlanStore.getState()).toMatchObject({
         isOpen: true,
         prefill: { prompt: failedPlan.sourcePrompt },
      });
   },
};

export const BlockedQuestions: Story = {
   render: () => <PlanBlockedQuestions record={blockedPlan} onAnswer={fn()} />,
};
