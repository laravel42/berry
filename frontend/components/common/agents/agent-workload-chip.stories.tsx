import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { AgentWorkloadChip } from './agent-workload-chip';
import { frontendAgent, releaseAgent, rosterMap } from './stories-fixtures';

const meta = {
   component: AgentWorkloadChip,
   tags: ['ai-generated'],
   args: { roster: rosterMap.get(frontendAgent.id) },
} satisfies Meta<typeof AgentWorkloadChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A run in flight: "Working", on the busy tone, whatever else is queued. */
export const Working: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Working')).toBeVisible();
      await expect(canvas.getByRole('img', { name: 'Working' })).toBeInTheDocument();
   },
};

/** Nothing running, something waiting: the count is said rather than implied. */
export const Queued: Story = {
   args: { roster: { ...rosterMap.get(frontendAgent.id)!, running: 0, queued: 3 } },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('3 queued')).toBeVisible();
   },
};

/** No run in flight and nothing queued: idle, on the offline tone. */
export const Idle: Story = {
   args: { roster: rosterMap.get(releaseAgent.id) },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Idle')).toBeVisible();
   },
};

/** The roster has not loaded yet: the chip renders nothing rather than guessing. */
export const RosterNotLoaded: Story = {
   args: { roster: undefined },
   play: async ({ canvasElement }) => {
      await expect(canvasElement.querySelector('span')).toBeNull();
   },
};
