import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { http, HttpResponse } from 'msw';
import { outdatedRunIds, RunEntry } from './run-entry';
import {
   deliveredRun,
   failedRun,
   persistHealth,
   runningRun,
   seedIssuesWorkspace,
} from '../stories-fixtures';

const meta = {
   component: RunEntry,
   tags: ['ai-generated', 'needs-work'],
   args: {
      run: deliveredRun,
      all: [failedRun, deliveredRun],
      issueId: persistHealth.id,
      outdated: false,
      onRunChanged: fn(),
   },
   decorators: [
      (Story) => (
         <div className="w-[720px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: () => {
      seedIssuesWorkspace();
   },
} satisfies Meta<typeof RunEntry>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One line until asked: the output folds under the toggle. */
export const Collapsed: Story = {
   play: async ({ canvas, userEvent }) => {
      const toggle = canvas.getByRole('button', { name: 'Show the output' });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(toggle);
      await expect(canvas.getByRole('button', { name: 'Hide the output' })).toHaveAttribute(
         'aria-expanded',
         'true'
      );
   },
};

/** A run a newer one replaced is marked, and its failure is behind the toggle. */
export const Outdated: Story = {
   args: { run: failedRun, outdated: true },
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.getByText('Outdated')).toBeVisible();
      await expect(
         canvas.queryByText('Migration 061 collided with an applied checksum.')
      ).not.toBeInTheDocument();
      await userEvent.click(canvas.getByRole('button', { name: 'Show the output' }));
      await expect(
         canvas.getByText('Migration 061 collided with an applied checksum.')
      ).toBeVisible();
   },
};

/** Only a newer success replaces a run: a later failure or a running run does not. */
export const OutdatedRule: Story = {
   play: async () => {
      const at = (minute: number) => `2026-09-26T23:${String(minute).padStart(2, '0')}:00Z`;
      const ok = { ...deliveredRun, id: 'ok', createdAt: at(10) };
      const earlier = { ...failedRun, id: 'earlier', createdAt: at(5) };
      const later = { ...failedRun, id: 'later', createdAt: at(20) };
      const running = {
         ...deliveredRun,
         id: 'running',
         status: 'running' as const,
         createdAt: at(30),
      };
      const outdated = outdatedRunIds([earlier, ok, later, running]);
      await expect([...outdated]).toEqual(['earlier']);
      await expect(outdatedRunIds([earlier, later]).size).toBe(0);
   },
};

/** A running run pulses and offers Cancel instead of Run again. */
export const Running: Story = {
   args: { run: runningRun, all: [runningRun] },
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/runs/:runId/cancel', () =>
            HttpResponse.json({ ...runningRun, status: 'cancelled' })
         )
      );
   },
   play: async ({ args, canvas, userEvent }) => {
      await expect(canvas.queryByRole('button', { name: 'Run again' })).not.toBeInTheDocument();
      await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
      await waitFor(() =>
         expect(args.onRunChanged).toHaveBeenCalledWith(
            expect.objectContaining({ id: runningRun.id, status: 'cancelled' })
         )
      );
   },
};
