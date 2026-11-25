import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { AgentWorkloadMark } from './agent-workload-mark';
import { frontendAgent, releaseAgent, rosterMap } from './stories-fixtures';

const meta = {
   component: AgentWorkloadMark,
   tags: ['ai-generated'],
   args: { roster: rosterMap.get(frontendAgent.id) },
} satisfies Meta<typeof AgentWorkloadMark>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A run in flight: "Working", and the only state whose dot keeps pulsing. */
export const Working: Story = {
   play: async ({ canvas, canvasElement }) => {
      await expect(canvas.getByText('Working')).toBeVisible();
      await expect(canvasElement.querySelector('.animate-ping')).not.toBeNull();
   },
};

/** Nothing running, something waiting: the count is said, and the dot holds still. */
export const Queued: Story = {
   args: { roster: { ...rosterMap.get(frontendAgent.id)!, running: 0, queued: 3 } },
   play: async ({ canvas, canvasElement }) => {
      await expect(canvas.getByText('3 queued')).toBeVisible();
      await expect(canvasElement.querySelector('.animate-ping')).toBeNull();
   },
};

/** No run in flight and nothing queued: idle, greyed out. */
export const Idle: Story = {
   args: { roster: rosterMap.get(releaseAgent.id) },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Idle')).toBeVisible();
   },
};

/** Beside a title, the way the agent's header sets it. */
export const BesideTheName: Story = {
   args: { tint: '#8a9a5b' },
   render: (args) => (
      <div className="flex items-start gap-2">
         <h1 className="leading-tight">Frontend Engineer</h1>
         <AgentWorkloadMark {...args} className="-mt-1.5" />
      </div>
   ),
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { name: 'Frontend Engineer' })).toBeVisible();
   },
};

/** The roster has not loaded yet: nothing rather than a guess. */
export const RosterNotLoaded: Story = {
   args: { roster: undefined },
   play: async ({ canvasElement }) => {
      await expect(canvasElement.querySelector('[data-workload]')).toBeNull();
   },
};
