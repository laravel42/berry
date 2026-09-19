import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import type { User } from '@/data/users';
import { ActorAvatar } from './actor-avatar';

const person: User = {
   id: 'user-1',
   name: 'Andrea Lunelio',
   avatarUrl: '',
   email: 'andrea@example.com',
   status: 'online',
   role: 'Admin',
   joinedDate: '2026-01-10',
   teamIds: [],
   timezone: 'Europe/Rome',
};

const agent: User = { ...person, id: 'agent-7', name: 'Backend Engineer', role: 'Application' };

const meta = {
   component: ActorAvatar,
   tags: ['ai-generated'],
   args: { user: person },
} satisfies Meta<typeof ActorAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Person: Story = {
   play: async ({ canvas }) => {
      // No photo: initials stand in, and the role is spoken for screen readers.
      await expect(canvas.getByText('AL')).toBeInTheDocument();
      await expect(canvas.getByText(/Andrea Lunelio, /)).toBeInTheDocument();
   },
};

export const Agent: Story = {
   args: { user: agent },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('img', { name: /^Backend Engineer, / })).toBeInTheDocument();
   },
};

export const AgentWithMonogram: Story = { args: { user: agent, monogram: true } };
export const Small: Story = { args: { size: 'sm' } };
