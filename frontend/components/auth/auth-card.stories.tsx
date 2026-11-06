import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import {
   AuthField,
   AuthFieldGroup,
   AuthPrimaryButton,
   AuthSecondaryButton,
} from '@/components/auth/auth-fields';
import { AuthCard } from './auth-card';

const meta = {
   component: AuthCard,
   tags: ['ai-generated'],
   parameters: { layout: 'fullscreen' },
   args: {
      title: 'Sign in to Berry',
      description: 'Welcome back.',
      topAction: (
         <>
            No account?{' '}
            <button type="button" className="text-[#e8c15c]">
               Sign up
            </button>
         </>
      ),
      children: (
         <div className="flex flex-col gap-3.5">
            <AuthFieldGroup label="Email" htmlFor="story-email">
               <AuthField id="story-email" placeholder="you@company.com" />
            </AuthFieldGroup>
            <AuthPrimaryButton ready>Sign in</AuthPrimaryButton>
            <AuthSecondaryButton>Continue with GitHub</AuthSecondaryButton>
         </div>
      ),
   },
} satisfies Meta<typeof AuthCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignIn: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('Sign in to Berry');
      await expect(canvas.getByLabelText('Berry')).toBeVisible();
   },
};

export const Invitation: Story = {
   args: {
      title: 'You’re invited',
      description: 'Join the Laravel42 workspace on Berry.',
      topAction: undefined,
      children: (
         <div className="flex flex-col gap-3.5">
            <AuthPrimaryButton ready>Join Laravel42</AuthPrimaryButton>
            <AuthSecondaryButton>Create my own workspace instead</AuthSecondaryButton>
         </div>
      ),
   },
};

export const WithError: Story = {
   args: {
      error: 'Email or password is incorrect.',
   },
};

export const Checking: Story = {
   args: {
      title: 'Checking the link…',
      description: undefined,
      topAction: undefined,
      children: <p className="text-center text-[var(--brand-ash)]">One moment.</p>,
   },
};

export const WithFooter: Story = {
   args: {
      title: 'Invitation declined',
      description: 'Nothing was added to your account.',
      topAction: undefined,
      children: <AuthPrimaryButton ready>Go to my workspaces</AuthPrimaryButton>,
      footer: (
         <span>
            Wrong account? <a href="#sign-in">Sign in as someone else</a>
         </span>
      ),
   },
};
