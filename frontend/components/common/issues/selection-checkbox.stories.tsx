import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useIssueSelectionStore } from '@/store/issue-selection-store';
import { SelectionCheckbox } from './selection-checkbox';
import { storyIssues } from './stories-fixtures';

const order = storyIssues.slice(0, 4).map((issue) => issue.id);

/** Four rows as a list draws them: the box sits at the start of each. */
function Rows({ order }: { order: string[] }) {
   return (
      <ul className="flex w-80 flex-col">
         {order.map((id) => (
            <li key={id} className="group flex items-center gap-2 border-b py-2">
               <SelectionCheckbox issueId={id} order={order} />
               <span>{storyIssues.find((issue) => issue.id === id)?.identifier}</span>
            </li>
         ))}
      </ul>
   );
}

const meta = {
   component: Rows,
   tags: ['ai-generated', 'needs-work'],
   args: { order },
   beforeEach: () => {
      useIssueSelectionStore.setState({ selected: [], anchor: null });
   },
} satisfies Meta<typeof Rows>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NothingSelected: Story = {};

export const OneSelected: Story = {
   beforeEach: () => {
      useIssueSelectionStore.setState({ selected: [order[1]!], anchor: order[1]! });
   },
   play: async ({ canvas }) => {
      const boxes = canvas.getAllByRole('checkbox', { name: 'Select task' });
      await expect(boxes[1]).toHaveAttribute('data-state', 'checked');
      await expect(boxes[0]).toHaveAttribute('data-state', 'unchecked');
   },
};

export const ShiftClickSelectsRange: Story = {
   play: async ({ canvas, userEvent }) => {
      const boxes = canvas.getAllByRole('checkbox', { name: 'Select task' });
      await userEvent.click(boxes[0]!);
      await userEvent.keyboard('{Shift>}');
      await userEvent.click(boxes[3]!);
      await userEvent.keyboard('{/Shift}');
      // Everything between the first plain click and the shift-click.
      await expect(useIssueSelectionStore.getState().selected).toEqual(order);
   },
};
