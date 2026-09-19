import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { IssueListError, IssueListSkeleton } from './list-states';

const retry = fn();

const meta = {
   component: IssueListSkeleton,
   tags: ['ai-generated', 'needs-work'],
   args: { mode: 'list' },
   decorators: [
      (Story) => (
         <div className="h-[420px] w-[760px] overflow-hidden border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof IssueListSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ListLoading: Story = {};
export const BoardLoading: Story = { args: { mode: 'grid' } };
export const TableLoading: Story = { args: { mode: 'table' } };
export const TimelineLoading: Story = { args: { mode: 'gantt' } };

export const LoadFailed: Story = {
   render: () => <IssueListError message="" onRetry={retry} />,
   play: async ({ canvas, userEvent }) => {
      // An empty message falls back to the catalogue's own wording.
      await expect(canvas.getByText('Those tasks could not be loaded.')).toBeInTheDocument();
      await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
      await expect(retry).toHaveBeenCalled();
   },
};
