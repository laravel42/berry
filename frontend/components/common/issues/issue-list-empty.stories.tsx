import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { expect } from 'storybook/test';
import { IssueListEmpty } from './issue-list-empty';

const meta = {
   component: IssueListEmpty,
   tags: ['ai-generated', 'needs-work'],
   args: { filtered: false },
} satisfies Meta<typeof IssueListEmpty>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyWorkspace: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No tasks yet.')).toBeInTheDocument();
      await expect(canvas.queryByRole('button', { name: 'Create task' })).toBeNull();
   },
};

export const FiltersMatchNothing: Story = {
   args: { filtered: true },
   decorators: [
      (Story) => (
         <NuqsTestingAdapter
            searchParams={{
               filters: JSON.stringify([
                  { columnId: 'priority', type: 'option', operator: 'is', values: ['urgent'] },
               ]),
            }}
         >
            <Story />
         </NuqsTestingAdapter>
      ),
   ],
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No task matches these filters.')).toBeInTheDocument();
      await expect(canvas.getByRole('button', { name: 'Clear filters' })).toBeEnabled();
   },
};
