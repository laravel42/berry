import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, within } from 'storybook/test';
import { priorities, type Priority } from '@/data/priorities';
import { PriorityPicker } from './priority-picker';

const priority = (id: string): Priority => priorities.find((entry) => entry.id === id)!;

const meta = {
   component: PriorityPicker,
   args: { priority: priority('high'), onChange: fn(), variant: 'icon' },
   // The parent owns the value, as every call site does.
   render: function Render(args) {
      const [value, setValue] = useState(args.priority);
      return (
         <PriorityPicker
            {...args}
            priority={value}
            onChange={(next) => {
               setValue(next);
               args.onChange(next);
            }}
         />
      );
   },
} satisfies Meta<typeof PriorityPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A row or property panel: the glyph alone, named "Priority: High". */
export const IconHigh: Story = {
   play: async ({ canvas }) => {
      const trigger = canvas.getByRole('combobox', { name: 'Priority: High' });
      await expect(trigger).toHaveAttribute('title', 'Priority: High');
   },
};

export const IconUrgent: Story = { args: { priority: priority('urgent') } };
export const IconNoPriority: Story = { args: { priority: priority('no-priority') } };

export const IconChange: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox', { name: 'Priority: High' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /Low/ }));
      await expect(args.onChange).toHaveBeenCalledWith(priority('low'));
      await expect(canvas.getByRole('combobox', { name: 'Priority: Low' })).toBeVisible();
   },
};

/** A create dialog: glyph and name on a chip. The unset tier reads muted. */
export const ChipNoPriority: Story = {
   args: { variant: 'chip', priority: priority('no-priority') },
   play: async ({ canvas }) => {
      const trigger = canvas.getByRole('combobox');
      await expect(trigger).toHaveTextContent('No priority');
      await expect(trigger).toHaveClass('text-muted-foreground');
   },
};

export const ChipChoose: Story = {
   args: { variant: 'chip', priority: priority('no-priority') },
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox'));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /Medium/ }));
      await expect(args.onChange).toHaveBeenCalledWith(priority('medium'));
      await expect(canvas.getByRole('combobox')).toHaveTextContent('Medium');
      await expect(canvas.getByRole('combobox')).not.toHaveClass('text-muted-foreground');
   },
};

/** With `countFor`, each option says how many tasks sit at that tier. */
export const WithCounts: Story = {
   args: { countFor: (id: string) => (id === 'urgent' ? 3 : 0) },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox'));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('option', { name: /Urgent/ })).toHaveTextContent('3');
   },
};
