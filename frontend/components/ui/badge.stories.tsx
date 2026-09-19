import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Bot } from 'lucide-react';
import { expect } from 'storybook/test';
import { Badge } from './badge';

const meta = {
   component: Badge,
   tags: ['ai-generated', 'needs-work'],
   args: { children: 'In review' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Secondary: Story = { args: { variant: 'secondary', children: 'Backlog' } };
export const Destructive: Story = { args: { variant: 'destructive', children: 'Failed' } };

export const OutlineWithIcon: Story = {
   args: {
      variant: 'outline',
      children: (
         <>
            <Bot />
            Backend Engineer
         </>
      ),
   },
};

export const AsLink: Story = {
   args: {
      asChild: true,
      variant: 'outline',
      children: <a href="#berr-42">BERR-42</a>,
   },
   play: async ({ canvas }) => {
      // asChild hands the badge styling to the anchor instead of wrapping it.
      const link = canvas.getByRole('link', { name: 'BERR-42' });
      await expect(link).toHaveAttribute('data-slot', 'badge');
   },
};
