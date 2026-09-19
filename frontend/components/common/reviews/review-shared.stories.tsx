import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { DiffStat, IssueCheckIcon, PeerVerdictChip, PrIcon } from './review-shared';

const meta = {
   component: PrIcon,
   tags: ['ai-generated', 'needs-work'],
   args: { status: 'open' },
} satisfies Meta<typeof PrIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Waiting: Story = {
   play: async ({ canvas }) => {
      // Colour alone never carries the state; the hidden label does too.
      await expect(canvas.getByText('Waiting for a decision')).toBeInTheDocument();
   },
};

/** Every state, including a waiting task whose run committed nothing. */
export const AllStates: Story = {
   render: () => (
      <div className="flex flex-col gap-2">
         {(
            [
               ['open', false, 'Waiting for a decision'],
               ['open', true, 'Waiting, nothing committed'],
               ['merged', false, 'Approved'],
               ['closed', false, 'Sent back'],
            ] as const
         ).map(([status, muted, label]) => (
            <div key={label} className="flex items-center gap-2">
               <PrIcon status={status} muted={muted} />
               <span className="text-muted-foreground">{label}</span>
            </div>
         ))}
      </div>
   ),
};

export const DiffStats: Story = {
   render: () => (
      <div className="flex flex-col gap-1">
         <DiffStat additions={46} deletions={7} />
         <DiffStat additions={128} deletions={0} />
      </div>
   ),
};

/** One vocabulary for a peer verdict wherever it appears. */
export const PeerVerdicts: Story = {
   render: () => (
      <div className="flex items-center gap-2">
         <PeerVerdictChip verdict={{ approved: true, reviewer: 'Code Reviewer' }} />
         <PeerVerdictChip verdict={{ approved: false, reviewer: 'Code Reviewer' }} />
         <PeerVerdictChip verdict={{ approved: null, reviewer: 'Code Reviewer' }} />
         <IssueCheckIcon />
      </div>
   ),
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Peer sent back')).toHaveAttribute(
         'title',
         'Peer review by Code Reviewer'
      );
   },
};
