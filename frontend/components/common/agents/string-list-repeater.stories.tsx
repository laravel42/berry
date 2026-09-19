import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { StringListRepeater } from './string-list-repeater';
import { frontendContract } from './stories-fixtures';

const meta = {
   component: StringListRepeater,
   tags: ['ai-generated', 'needs-work'],
   args: {
      title: 'Responsibilities',
      description: 'What this role is accountable for.',
      value: frontendContract.responsibilities,
      onChange: fn(),
   },
   decorators: [
      (Story) => (
         <div className="w-[640px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof StringListRepeater>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Editable: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: /add/i }));
      // Adding appends an empty row for the caller to hold.
      await expect(args.onChange).toHaveBeenCalledWith([...frontendContract.responsibilities, '']);
   },
};

export const Empty: Story = { args: { value: [], emptyLabel: 'Nothing listed yet.' } };

/** Read-only: no add button, no remove buttons, inputs disabled. */
export const Disabled: Story = {
   args: { disabled: true },
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('button')).toBeNull();
   },
};
