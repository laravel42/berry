import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Plus } from 'lucide-react';
import { expect, fn } from 'storybook/test';
import { Button } from './button';

const meta = {
   component: Button,
   tags: ['ai-generated'],
   args: { children: 'Create task', onClick: fn() },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: /create task/i }));
      await expect(args.onClick).toHaveBeenCalledTimes(1);
   },
};

export const Secondary: Story = { args: { variant: 'secondary' } };
export const Outline: Story = { args: { variant: 'outline', size: 'xs' } };
export const Destructive: Story = { args: { variant: 'destructive', children: 'Clear' } };

export const WithIcon: Story = {
   args: {
      size: 'xs',
      variant: 'secondary',
      children: (
         <>
            <Plus className="size-4" />
            Create
         </>
      ),
   },
};

export const Disabled: Story = {
   args: { disabled: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: /create task/i })).toBeDisabled();
   },
};

export const CssCheck: Story = {
   args: { size: 'xs', children: 'Filter' },
   play: async ({ canvas }) => {
      const button = canvas.getByRole('button', { name: /filter/i });
      // size="xs" is Tailwind's h-7 — 28px only if app/globals.css loaded.
      await expect(getComputedStyle(button).height).toBe('28px');
   },
};
