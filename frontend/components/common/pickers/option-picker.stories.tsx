import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Circle } from 'lucide-react';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { OptionPicker, PickerChipButton, PickerIconButton } from './option-picker';

const fruit = [
   { value: 'apple', label: 'Apple', icon: <Circle /> },
   { value: 'pear', label: 'Pear', icon: <Circle /> },
   { value: 'plum', label: 'Plum', icon: <Circle /> },
];

const meta = {
   component: OptionPicker,
   args: {
      options: fruit,
      value: 'pear',
      onValueChange: fn(),
      emptyLabel: 'Nothing to pick.',
      children: <PickerChipButton>Pear</PickerChipButton>,
   },
} satisfies Meta<typeof OptionPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The chip trigger is a combobox; Radix reports whether its menu is open. */
export const Chip: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
   },
};

/** The icon trigger has no text, so it is named by its required aria-label. */
export const Icon: Story = {
   args: {
      children: (
         <PickerIconButton aria-label="Fruit: Pear">
            <Circle />
         </PickerIconButton>
      ),
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('combobox', { name: 'Fruit: Pear' })).toBeVisible();
   },
};

/** Choosing reports the value and closes the menu. The current option carries the check. */
export const ChooseCloses: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      const trigger = canvas.getByRole('combobox');
      await userEvent.click(trigger);
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const body = within(canvasElement.ownerDocument.body);
      const current = await body.findByRole('option', { name: /Pear/ });
      await expect(current.querySelector('svg.lucide-check')).not.toBeNull();
      await expect(
         body.getByRole('option', { name: /Plum/ }).querySelector('svg.lucide-check')
      ).toBeNull();
      await userEvent.click(body.getByRole('option', { name: /Plum/ }));
      await expect(args.onValueChange).toHaveBeenCalledWith('plum');
      await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
   },
};

/**
 * Keyboard: Enter opens the menu on the current choice, the arrow keys move,
 * Enter chooses, and focus returns to the trigger.
 */
export const Keyboard: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      const trigger = canvas.getByRole('combobox');
      trigger.focus();
      await userEvent.keyboard('{Enter}');
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('option', { name: /Pear/ })).toHaveAttribute(
         'aria-selected',
         'true'
      );
      await expect(body.getByRole('listbox')).toHaveFocus();
      await userEvent.keyboard('{ArrowDown}{Enter}');
      await expect(args.onValueChange).toHaveBeenCalledWith('plum');
      await waitFor(() => expect(trigger).toHaveFocus());
   },
};

/** Escape closes the menu without choosing. */
export const EscapeCloses: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      const trigger = canvas.getByRole('combobox');
      await userEvent.click(trigger);
      await within(canvasElement.ownerDocument.body).findByRole('option', { name: /Apple/ });
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
      await expect(args.onValueChange).not.toHaveBeenCalled();
   },
};

/** Counts are read only while the menu is open, so a row never pays for them. */
export const LazyCounts: Story = {
   args: { countFor: fn((value: string) => value.length) },
   play: async ({ canvas, canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(body.queryByRole('option')).toBeNull();
      await userEvent.click(canvas.getByRole('combobox'));
      await expect(await body.findByRole('option', { name: /Apple/ })).toHaveTextContent('5');
   },
};

export const Empty: Story = {
   args: { options: [], value: undefined },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox'));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Nothing to pick.')).toBeVisible();
   },
};

/** Controlled: the caller renders the trigger from its own value. */
export const Controlled: Story = {
   render: function Render(args) {
      const [value, setValue] = useState('apple');
      const chosen = fruit.find((item) => item.value === value);
      return (
         <OptionPicker {...args} value={value} onValueChange={setValue}>
            <PickerChipButton>{chosen?.label}</PickerChipButton>
         </OptionPicker>
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox'));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /Plum/ }));
      await expect(canvas.getByRole('combobox')).toHaveTextContent('Plum');
   },
};

/** A fixed 12rem menu for a trigger too small to size one by. */
export const MenuWidth: Story = {
   args: { menuWidth: 'menu' },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox'));
      const body = within(canvasElement.ownerDocument.body);
      const option = await body.findByRole('option', { name: /Apple/ });
      await expect(option.closest('[data-slot="popover-content"]')).toHaveClass('w-48');
   },
};
