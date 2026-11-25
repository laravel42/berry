import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import {
   AuthField,
   AuthFieldGroup,
   AuthPasswordField,
   AuthPrimaryButton,
   AuthSecondaryButton,
   authLinkClass,
} from '@/components/auth/auth-fields';
import { AuthCard, AuthLegalNote } from './auth-card';

const meta = {
   component: AuthCard,
   tags: ['ai-generated'],
   parameters: { layout: 'fullscreen' },
   args: {
      title: 'Sign in to Berry',
      description: 'Welcome back.',
      aside: (
         <>
            <p>
               No account?{' '}
               <button type="button" className={authLinkClass}>
                  Sign up
               </button>
            </p>
            <AuthLegalNote />
         </>
      ),
      children: (
         <div className="flex flex-col gap-4">
            <AuthFieldGroup label="Email" htmlFor="story-email">
               <AuthField id="story-email" placeholder="you@company.com" />
            </AuthFieldGroup>
            <AuthFieldGroup label="Password" htmlFor="story-password">
               <AuthPasswordField id="story-password" placeholder="••••••••••••" />
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
      await expect(canvas.getByLabelText('Berry home')).toBeVisible();
   },
};

export const Invitation: Story = {
   args: {
      title: 'You’re invited',
      description: 'Join the Laravel42 workspace on Berry.',
      aside: undefined,
      children: (
         <div className="flex flex-col gap-4">
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
      aside: undefined,
      children: <p className="text-center text-muted-foreground">One moment.</p>,
   },
};

export const WithAside: Story = {
   args: {
      title: 'Invitation declined',
      description: 'Nothing was added to your account.',
      children: <AuthPrimaryButton ready>Go to my workspaces</AuthPrimaryButton>,
      aside: (
         <p>
            Wrong account?{' '}
            <a href="#sign-in" className={authLinkClass}>
               Sign in as someone else
            </a>
         </p>
      ),
   },
};
