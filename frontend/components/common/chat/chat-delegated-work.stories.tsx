import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { ChatDelegatedWork } from './chat-tasks-panel';

const meta = {
   component: ChatDelegatedWork,
   tags: ['ai-generated'],
   args: {
      tasks: [
         {
            id: 'run-90',
            status: 'running',
            priority: 0,
            createdAt: '2026-09-18T12:00:00Z',
            startedAt: '2026-09-18T12:00:04Z',
            delegated: true,
            agentName: 'Backend Engineer',
            issueIdentifier: 'BERR-42',
         },
         {
            id: 'run-91',
            status: 'queued',
            priority: 0,
            createdAt: '2026-09-18T12:00:10Z',
            startedAt: null,
            delegated: true,
            agentName: 'QA Engineer',
            issueIdentifier: 'BERR-43',
         },
      ],
   },
   decorators: [
      (Story) => (
         <div className="w-[560px] bg-[var(--shell-canvas)] text-[var(--shell-text)]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ChatDelegatedWork>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Work the agent handed off, followed by name and task until each run ends. */
export const TwoFollowed: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Following 2 runs this chat started')).toBeVisible();
      await expect(canvas.getByText('Backend Engineer · BERR-42')).toBeVisible();
      await expect(canvas.getByText('Working')).toBeVisible();
      await expect(canvas.getByText('Waiting to start')).toBeVisible();
   },
};

/** Nothing handed off: nothing rendered. */
export const NothingFollowed: Story = {
   args: { tasks: [] },
   play: async ({ canvas }) => {
      await expect(canvas.queryByText(/Following/)).toBeNull();
   },
};
