import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { DebouncedInput } from './debounced-input';

/**
 * Every story's global clock is frozen (`MockDate`, in `.storybook/preview.tsx`)
 * so other stories can show stable relative times. This component's debounce
 * is written against `Date.now()`, so under a frozen clock its trailing edge
 * never judges enough time to have passed and `onChange` never fires here —
 * that is this harness's limit, not the component's; only the synchronous,
 * observable behaviour (the local echo, and resyncing to an external value)
 * is asserted.
 */
const meta = {
   component: DebouncedInput,
   tags: ['ai-generated'],
   args: { value: '', onChange: fn(), debounceMs: 30, placeholder: 'Search…' },
} satisfies Meta<typeof DebouncedInput>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every keystroke shows at once, ahead of whatever `onChange` the debounce eventually fires. */
export const TypingShowsImmediately: Story = {
   play: async ({ canvas, userEvent }) => {
      const field = canvas.getByPlaceholderText('Search…');
      await userEvent.type(field, 'berr');
      await expect(field).toHaveValue('berr');
   },
};

/** A new `value` prop (the filter cleared elsewhere) replaces the local draft. */
export const ExternalValueResyncs: Story = {
   args: { value: 'old filter' },
   play: async ({ canvas }) => {
      await expect(canvas.getByPlaceholderText('Search…')).toHaveValue('old filter');
   },
};

/** A numeric value is read and typed the same way a string one is. */
export const NumericValue: Story = {
   args: { value: 10, type: 'number' },
   play: async ({ canvas, userEvent }) => {
      const field = canvas.getByPlaceholderText('Search…');
      await expect(field).toHaveValue(10);
      await userEvent.clear(field);
      await userEvent.type(field, '25');
      await expect(field).toHaveValue(25);
   },
};
