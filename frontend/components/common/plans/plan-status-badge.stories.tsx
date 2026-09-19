import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import {
   blockedPlan,
   compileFailedPlan,
   failedPlan,
   generatingPlan,
   invalidPlan,
   pendingApprovalPlan,
   readyPlan,
   startedPlan,
} from './plan-fixtures';
import { PlanStatusBadge } from './plan-status-badge';

const meta = {
   component: PlanStatusBadge,
   tags: ['ai-generated', 'needs-work'],
   args: { record: readyPlan },
} satisfies Meta<typeof PlanStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Draft: Story = {};

export const Planning: Story = { args: { record: generatingPlan } };

export const NeedsAnswers: Story = { args: { record: blockedPlan } };

/** Every look side by side, in the order a plan moves through them. */
export const AllStates: Story = {
   render: () => (
      <div className="flex flex-wrap gap-2">
         {[
            generatingPlan,
            failedPlan,
            blockedPlan,
            invalidPlan,
            readyPlan,
            pendingApprovalPlan,
            startedPlan,
            compileFailedPlan,
            { ...readyPlan, id: 'plan-rejected', status: 'rejected' as const },
            { ...readyPlan, id: 'plan-superseded', status: 'superseded' as const },
         ].map((record) => (
            <PlanStatusBadge key={record.id} record={record} />
         ))}
      </div>
   ),
};
