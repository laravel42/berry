import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { Button } from '@/components/ui/button';
import { AuthCard } from './auth-card';

const meta = {
   component: AuthCard,
   tags: ['ai-generated', 'needs-work'],
   parameters: { layout: 'fullscreen' },
   args: {
      title: 'Join Acme Engineering',
      description: 'Andrea Lunelio invited you as a member.',
      children: (
         <div className="flex flex-col gap-2">
            <Button>Accept invitation</Button>
            <Button variant="secondary">Decline</Button>
         </div>
      ),
   },
} satisfies Meta<typeof AuthCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Invitation: Story = {
   play: async ({ canvas }) => {
      // The title is the page's one heading.
      await expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent(
         'Join Acme Engineering'
      );
      await expect(canvas.getByLabelText('Berry')).toBeVisible();
   },
};

export const Checking: Story = {
   args: {
      title: 'Checking the link…',
      description: undefined,
      children: <p className="text-center text-muted-foreground">One moment.</p>,
   },
};

export const WithFooter: Story = {
   args: {
      title: 'Invitation declined',
      description: 'Nothing was added to your account.',
      children: <Button className="w-full">Go to my workspaces</Button>,
      footer: (
         <span>
            Wrong account? <a href="#sign-in">Sign in as someone else</a>
         </span>
      ),
   },
};
