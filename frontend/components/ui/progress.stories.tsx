import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { Progress } from './progress';

const meta = {
   component: Progress,
   tags: ['ai-generated', 'needs-work'],
   args: { 'value': 60, 'aria-label': 'Goal progress' },
   decorators: [
      (Story) => (
         <div className="w-[320px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Partial: Story = {
   // The value reaches the Radix root, so assistive tech hears the progress
   // instead of an indeterminate bar.
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('progressbar', { name: 'Goal progress' })).toHaveAttribute(
         'aria-valuenow',
         '60'
      );
   },
};

export const Empty: Story = { args: { value: 0 } };
export const Complete: Story = { args: { value: 100 } };

export const Indeterminate: Story = {
   args: { value: null },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('progressbar')).toHaveAttribute('data-state', 'indeterminate');
   },
};
