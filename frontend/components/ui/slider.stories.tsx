import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { Slider } from './slider';

const meta = {
   component: Slider,
   tags: ['ai-generated', 'needs-work'],
   args: {
      'defaultValue': [3],
      'min': 1,
      'max': 5,
      'step': 1,
      'onValueChange': fn(),
      'aria-label': 'Autonomy',
   },
   decorators: [
      (Story) => (
         <div className="w-[320px] py-4">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An agent's autonomy level, 1–5. */
export const Single: Story = {
   play: async ({ args, canvas, userEvent }) => {
      const thumb = canvas.getByRole('slider');
      await expect(thumb).toHaveAttribute('aria-valuenow', '3');
      thumb.focus();
      await userEvent.keyboard('{ArrowRight}');
      await expect(thumb).toHaveAttribute('aria-valuenow', '4');
      await expect(args.onValueChange).toHaveBeenCalledWith([4]);
   },
};

export const Range: Story = {
   args: { 'defaultValue': [20, 80], 'min': 0, 'max': 100, 'step': 5, 'aria-label': undefined },
   play: async ({ canvas }) => {
      // One thumb per value.
      await expect(canvas.getAllByRole('slider')).toHaveLength(2);
   },
};

export const Disabled: Story = { args: { disabled: true } };
