import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { Input } from './input';

const meta = {
   component: Input,
   tags: ['ai-generated', 'needs-work'],
   args: { 'placeholder': 'Acme Engineering', 'onChange': fn(), 'aria-label': 'Workspace name' },
   decorators: [
      (Story) => (
         <div className="w-[320px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
   play: async ({ args, canvas, userEvent }) => {
      const input = canvas.getByRole('textbox', { name: 'Workspace name' });
      await userEvent.type(input, 'Berry');
      await expect(input).toHaveValue('Berry');
      await expect(args.onChange).toHaveBeenCalledTimes(5);
   },
};

export const Filled: Story = { args: { defaultValue: 'acme-engineering', className: 'font-mono' } };

export const Invalid: Story = { args: { 'defaultValue': 'Settings', 'aria-invalid': true } };

export const Disabled: Story = {
   args: { defaultValue: 'berry', disabled: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('textbox')).toBeDisabled();
   },
};

export const Password: Story = {
   args: { 'type': 'password', 'defaultValue': 'hunter2', 'aria-label': 'Token' },
};
