import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { SaveIndicator } from './save-indicator';

const meta = {
   component: SaveIndicator,
   tags: ['ai-generated', 'needs-work'],
   args: { state: 'saved' },
} satisfies Meta<typeof SaveIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Saving: Story = { args: { state: 'saving' } };

export const Saved: Story = {};

export const Failed: Story = {
   args: {
      state: 'failed',
      error: 'Names are limited to 80 characters.',
      onRetry: fn(),
   },
   play: async ({ args, canvas, userEvent }) => {
      // The live region is always mounted so the failure is announced.
      await expect(canvas.getByRole('status')).toHaveTextContent(
         'Names are limited to 80 characters.'
      );
      await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
      await expect(args.onRetry).toHaveBeenCalledOnce();
   },
};

export const FailedWithoutReason: Story = { args: { state: 'failed' } };
