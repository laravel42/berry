import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';

import { autopilots, orgParams } from '../agents/stories-fixtures';
import AutopilotLine from './autopilot-line';

const meta = {
   component: AutopilotLine,
   tags: ['ai-generated'],
   parameters: orgParams,
   args: {
      autopilot: autopilots[0]!,
      columns: ['status', 'mode', 'quota', 'updated'],
      assigneeName: 'Orchestrator',
      canEdit: true,
      selected: false,
      onToggleSelected: fn(),
      onPauseOrResume: fn(),
      onConfirmDelete: fn(),
      onRestore: fn(),
   },
} satisfies Meta<typeof AutopilotLine>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Active, with its quota and what it does on each run. Mode and quota are
 * `hidden lg:flex` / `hidden xl:flex`, so their cells are only checked for
 * presence rather than visibility.
 */
export const Active: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Morning triage')).toBeVisible();
      await expect(canvas.getByText('Active')).toBeVisible();
      await expect(canvas.getByText('Opens a task each run')).toBeInTheDocument();
      await expect(canvas.getByText('2 per day')).toBeInTheDocument();
   },
};

/** Paused: the menu offers Resume instead of Pause. */
export const Paused: Story = {
   args: { autopilot: autopilots[2]!, assigneeName: 'Frontend Engineer' },
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await expect(canvas.getByText('Paused')).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'Autopilot actions' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Resume' }));
      await expect(args.onPauseOrResume).toHaveBeenCalledWith(autopilots[2]);
   },
};

/** No quota set: says so instead of a blank cell. */
export const NoQuotaLimit: Story = {
   args: { autopilot: autopilots[1]!, assigneeName: 'release-notes' },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No limit')).toBeInTheDocument();
   },
};

/** Archived: the menu offers only Restore. */
export const Archived: Story = {
   args: { autopilot: { ...autopilots[0]!, status: 'archived' } },
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Autopilot actions' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Restore' }));
      await expect(args.onRestore).toHaveBeenCalledWith(
         expect.objectContaining({ id: autopilots[0]!.id })
      );
   },
};

/** A viewer's row has no checkbox and no menu, just a lock explaining why. */
export const LockedForViewers: Story = {
   args: { canEdit: false },
   play: async ({ canvas }) => {
      await expect(canvas.getByLabelText('Your role cannot change autopilots')).toBeInTheDocument();
      await expect(canvas.queryByRole('checkbox')).toBeNull();
   },
};
