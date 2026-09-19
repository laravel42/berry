import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn } from 'storybook/test';
import { SegmentedControl } from './segmented-control';

const ranges = [7, 30, 90].map((days) => ({ value: days, label: `${days} days` }));

const meta = {
   component: SegmentedControl<number>,
   args: { 'aria-label': 'Time range', 'options': ranges, 'value': 30, 'onValueChange': fn() },
   render: function Render(args) {
      const [value, setValue] = useState(args.value);
      return (
         <SegmentedControl
            {...args}
            value={value}
            onValueChange={(next) => {
               setValue(next);
               args.onValueChange(next);
            }}
         />
      );
   },
} satisfies Meta<typeof SegmentedControl<number>>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A named group; the current segment is pressed and filled. */
export const Default: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('group', { name: 'Time range' })).toBeVisible();
      await expect(canvas.getByRole('button', { name: '30 days' })).toHaveAttribute(
         'aria-pressed',
         'true'
      );
      await expect(canvas.getByRole('button', { name: '7 days' })).toHaveAttribute(
         'aria-pressed',
         'false'
      );
   },
};

export const Choose: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: '90 days' }));
      await expect(args.onValueChange).toHaveBeenCalledWith(90);
      await expect(canvas.getByRole('button', { name: '90 days' })).toHaveAttribute(
         'aria-pressed',
         'true'
      );
   },
};

/** Keyboard: Tab reaches each segment and Space presses it. */
export const Keyboard: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.tab();
      await expect(canvas.getByRole('button', { name: '7 days' })).toHaveFocus();
      await userEvent.keyboard(' ');
      await expect(args.onValueChange).toHaveBeenCalledWith(7);
   },
};

/** String values work the same: a chart metric. */
export const Metric: Story = {
   render: () => {
      const [metric, setMetric] = useState<'cost' | 'tokens'>('cost');
      return (
         <SegmentedControl
            aria-label="Trend metric"
            value={metric}
            onValueChange={setMetric}
            options={[
               { value: 'cost', label: 'Cost' },
               { value: 'tokens', label: 'Tokens' },
            ]}
         />
      );
   },
};
