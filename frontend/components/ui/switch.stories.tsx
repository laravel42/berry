import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { Label } from './label';
import { Switch } from './switch';

const meta = {
   component: Switch,
   tags: ['ai-generated', 'needs-work'],
   args: { onCheckedChange: fn() },
   render: (args) => (
      <div className="flex items-center gap-2">
         <Switch id="sticky-comment" {...args} />
         <Label htmlFor="sticky-comment">Keep the comment box in view</Label>
      </div>
   ),
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {
   play: async ({ args, canvas, userEvent }) => {
      const toggle = canvas.getByRole('switch', { name: 'Keep the comment box in view' });
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await userEvent.click(toggle);
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect(args.onCheckedChange).toHaveBeenCalledWith(true);
   },
};

export const On: Story = { args: { defaultChecked: true } };

export const Disabled: Story = {
   args: { disabled: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('switch')).toBeDisabled();
   },
};
