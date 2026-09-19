import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Skeleton } from './skeleton';

const meta = {
   component: Skeleton,
   tags: ['ai-generated', 'needs-work'],
   args: { className: 'h-4 w-48' },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Line: Story = {};

/** The shape a task row takes while the list loads. */
export const TaskRows: Story = {
   render: () => (
      <div className="flex w-[480px] flex-col gap-3">
         {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3">
               <Skeleton className="size-4 rounded-full" />
               <Skeleton className="h-4 w-16" />
               <Skeleton className="h-4 flex-1" />
               <Skeleton className="size-6 rounded-full" />
            </div>
         ))}
      </div>
   ),
};
