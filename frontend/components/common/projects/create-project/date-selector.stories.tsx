import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { ProjectDateSelector } from './date-selector';

const meta = {
   component: ProjectDateSelector,
   tags: ['ai-generated', 'needs-work'],
   args: { label: 'Target', onChange: fn() },
} satisfies Meta<typeof ProjectDateSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The create dialog chip before a date is chosen. */
export const ChipEmpty: Story = {};

export const ChipWithDate: Story = {
   args: { date: new Date(2026, 9, 30) },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Target: Oct 30, 2026' })).toHaveTextContent(
         'Oct 30'
      );
   },
};

/** The project sidebar row, empty: a dashed "Target date" prompt. */
export const RowEmpty: Story = { args: { layout: 'row', emptyLabel: 'Target date' } };

export const RowWithDate: Story = {
   args: { layout: 'row', label: 'Start', date: new Date(2026, 7, 3) },
};

/** Clearing is offered only once a date is set. */
export const ClearDate: Story = {
   args: { date: new Date(2026, 9, 30) },
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: /Target/ }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('button', { name: 'Clear date' }));
      await expect(args.onChange).toHaveBeenCalledWith(undefined);
   },
};
