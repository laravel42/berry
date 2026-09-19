import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { pendingApproval } from '../../../.storybook/msw-handlers';
import { ApprovalCard } from './approval-card';

const meta = {
   component: ApprovalCard,
   tags: ['ai-generated'],
   args: { approval: pendingApproval },
   decorators: [
      (Story) => (
         <div className="w-[560px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ApprovalCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TaskStart: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Start' }));
      // The decision goes through POST /api/v1/approvals/:id/approve (MSW);
      // the toast only appears once that response has been parsed.
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Started')).toBeVisible();
   },
};

export const HighRiskProposal: Story = {
   args: {
      approval: {
         ...pendingApproval,
         id: 'appr-2',
         kind: 'work_proposal',
         risk: 'high',
         title: 'Proposal: rotate the integration encryption key',
      },
   },
};

export const Compact: Story = { args: { compact: true } };

export const Resolved: Story = {
   args: {
      approval: {
         ...pendingApproval,
         status: 'approved',
         resolvedBy: 'user-1',
         resolvedAt: '2026-09-18T10:00:00Z',
      },
   },
};
