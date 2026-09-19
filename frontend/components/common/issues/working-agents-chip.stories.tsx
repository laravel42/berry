import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { useRunsStore } from '@/store/runs-store';
import { WorkingAgentsChip } from './working-agents-chip';
import { deliveredRun, queuedRun, runningRun, seedIssuesWorkspace } from './stories-fixtures';

const meta = {
   component: WorkingAgentsChip,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: () => {
      seedIssuesWorkspace();
   },
} satisfies Meta<typeof WorkingAgentsChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WorkingAndQueued: Story = {
   play: async ({ canvas }) => {
      // One run working, one queued, on two tasks by two agents.
      await expect(canvas.getByRole('button', { name: /2 agents · 2 tasks/ })).toHaveAttribute(
         'aria-pressed',
         'false'
      );
   },
};

export const OneAgentWorking: Story = {
   beforeEach: () => {
      useRunsStore.setState({ runs: [runningRun, deliveredRun] });
   },
};

export const NothingRunning: Story = {
   beforeEach: () => {
      useRunsStore.setState({ runs: [deliveredRun] });
   },
   play: async ({ canvasElement }) => {
      // Finished runs do not count: the chip stays out of the header.
      await expect(canvasElement.querySelector('button')).toBeNull();
   },
};

export const HoverListsTheWork: Story = {
   beforeEach: () => {
      useRunsStore.setState({ runs: [runningRun, queuedRun] });
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.hover(canvas.getByRole('button'));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('tooltip')).toHaveTextContent(
         /Backend Engineer · BERR-42/
      );
   },
};

export const ClickFiltersToThoseAgents: Story = {
   play: async ({ canvas, userEvent }) => {
      const chip = canvas.getByRole('button', { name: /agents/ });
      await userEvent.click(chip);
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(chip);
      await expect(chip).toHaveAttribute('aria-pressed', 'false');
   },
};
