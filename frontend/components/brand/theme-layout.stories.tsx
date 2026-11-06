import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { AuthPrimaryButton, AuthSecondaryButton } from '@/components/auth/auth-fields';
import { BrandThemeLayout } from '@/components/brand/theme-layout';

const meta = {
   component: BrandThemeLayout,
   tags: ['autodocs'],
   parameters: { layout: 'fullscreen' },
   args: {
      title: 'Workspace overview',
      description: 'Plan, run, and review work with people and agents on one board.',
      topAction: (
         <button type="button" className="text-[#e8c15c] hover:text-[#f2d27e]">
            Sign out
         </button>
      ),
      nav: [
         { id: 'overview', label: 'Overview', active: true },
         { id: 'tasks', label: 'Tasks' },
         { id: 'agents', label: 'Agents' },
         { id: 'settings', label: 'Settings' },
      ],
      children: (
         <div className="flex flex-col gap-4">
            <p className="m-0 leading-relaxed text-[var(--brand-body)]">
               This shell uses the Auth canvas: void ground, soft grid, gold accents, and the same
               panel treatment as sign-in.
            </p>
            <div className="flex max-w-sm flex-col gap-3">
               <AuthPrimaryButton ready>Continue</AuthPrimaryButton>
               <AuthSecondaryButton>Secondary action</AuthSecondaryButton>
            </div>
         </div>
      ),
   },
} satisfies Meta<typeof BrandThemeLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithSidebar: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
      await expect(canvas.getByRole('button', { name: /Overview/ })).toBeVisible();
   },
};

export const PanelOnly: Story = {
   args: {
      nav: undefined,
      title: 'Invite accepted',
      description: 'You are in. Open the board when you are ready.',
      children: <AuthPrimaryButton ready>Open workspace</AuthPrimaryButton>,
   },
};
