import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { andrea, maya, seedIssuesWorkspace } from '@/components/common/issues/stories-fixtures';
import type { User } from '@/data/users';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useSearchStore } from '@/store/search-store';

import MemberProfile from './member-profile';

/** Someone who joined this week and has nothing on their plate yet. */
const newcomer: User = {
   id: 'user-9',
   name: 'Lea Hoffmann',
   avatarUrl: '',
   email: 'lea@berry.dev',
   status: 'online',
   role: 'Member',
   joinedDate: '2026-09-15T08:00:00Z',
   teamIds: [],
   timezone: 'Europe/Berlin',
};

const meta = {
   component: MemberProfile,
   tags: ['ai-generated', 'needs-work'],
   args: { member: andrea },
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: { segments: [['orgId', 'berry']] } },
   },
   beforeEach: () => {
      seedIssuesWorkspace({ withSession: true });
      useSearchStore.setState({ isSearchOpen: false, searchQuery: '' });
   },
   decorators: [
      (Story) => (
         // The profile panel is `hidden lg:flex`: it needs a viewport at least 1024px wide.
         <div className="h-[640px] w-[1280px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof MemberProfile>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Andrea's assigned tasks grouped by status, with the identity panel beside them. */
export const AssignedTasks: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Share the list filter through the URL')).toBeInTheDocument();
      await expect(canvas.getByRole('heading', { name: 'Andrea Lunelio' })).toBeInTheDocument();
   },
};

/** A blocked, urgent task on Maya's plate. */
export const BlockedWork: Story = { args: { member: maya } };

/** Nothing assigned: the list's empty state and an empty breakdown. */
export const NothingAssigned: Story = {
   args: { member: newcomer },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Nothing to show yet.')).toBeInTheDocument();
   },
};

/** The insights panel replaces the profile panel when it is open. */
export const Insights: Story = {
   beforeEach: () => {
      useRightPanelStore.setState({ openPanel: 'insights' });
   },
};
