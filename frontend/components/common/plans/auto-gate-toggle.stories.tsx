import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { AutoGateToggle } from './auto-gate-toggle';

const meta = {
   component: AutoGateToggle,
   tags: ['ai-generated', 'needs-work'],
   args: { enabled: false, onChange: fn() },
} satisfies Meta<typeof AutoGateToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {
   play: async ({ args, canvas, userEvent }) => {
      const toggle = canvas.getByRole('button', { name: 'AutoGate' });
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      // Controlled: a click asks the parent to turn it on, it does not flip itself.
      await userEvent.click(toggle);
      await expect(args.onChange).toHaveBeenCalledWith(true);
   },
};

export const On: Story = {
   args: { enabled: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'AutoGate' })).toHaveAttribute(
         'aria-pressed',
         'true'
      );
   },
};
