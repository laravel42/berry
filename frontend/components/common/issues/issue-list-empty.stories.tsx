import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { expect } from 'storybook/test';
import { useCreateIssueStore } from '@/store/create-issue-store';
import { IssueListEmpty } from './issue-list-empty';

const meta = {
   component: IssueListEmpty,
   tags: ['ai-generated', 'needs-work'],
   args: { filtered: false },
   beforeEach: () => {
      useCreateIssueStore.getState().closeModal();
   },
} satisfies Meta<typeof IssueListEmpty>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyWorkspace: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.getByText('No tasks yet.')).toBeInTheDocument();
      await userEvent.click(canvas.getByRole('button', { name: 'Create task' }));
      // The call to action opens the shared create-task modal.
      await expect(useCreateIssueStore.getState().isOpen).toBe(true);
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
