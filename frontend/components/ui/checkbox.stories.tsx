import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { Checkbox } from './checkbox';
import { Label } from './label';

const meta = {
   component: Checkbox,
   tags: ['ai-generated', 'needs-work'],
   args: { onCheckedChange: fn() },
   render: (args) => (
      <div className="flex items-center gap-2">
         <Checkbox id="allow-invites" {...args} />
         <Label htmlFor="allow-invites">Members can invite others</Label>
      </div>
   ),
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {
   play: async ({ args, canvas, userEvent }) => {
      // Clicking the label toggles the box it is bound to.
      await userEvent.click(canvas.getByText('Members can invite others'));
      await expect(canvas.getByRole('checkbox')).toHaveAttribute('data-state', 'checked');
      await expect(args.onCheckedChange).toHaveBeenCalledWith(true);
   },
};

export const Checked: Story = { args: { defaultChecked: true } };

export const Disabled: Story = {
   args: { disabled: true, defaultChecked: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('checkbox')).toBeDisabled();
   },
};

export const Invalid: Story = { args: { 'aria-invalid': true } };
