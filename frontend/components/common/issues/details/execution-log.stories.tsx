import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor, within } from 'storybook/test';
import { ExecutionLog } from './execution-log';
import {
   approvalsInbox,
   deliveredRun,
   failedRun,
   persistHealth,
   runningRun,
   seedIssuesWorkspace,
} from '../stories-fixtures';

const retried = {
   ...failedRun,
   id: 'run-42-3',
   status: 'queued' as const,
   sequence: 3,
   failure: null,
   createdAt: '2026-09-18T12:00:00Z',
   startedAt: null,
   completedAt: null,
};

const meta = {
   component: ExecutionLog,
   tags: ['ai-generated', 'needs-work'],
   args: {
      issueId: persistHealth.id,
      issueRef: persistHealth.identifier,
      inReview: false,
      runs: [runningRun, failedRun],
      onRunsChanged: fn(),
   },
   decorators: [
      (Story) => (
         <div className="w-[720px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace();
      msw.use(
         http.post('*/api/v1/runs/:runId/cancel', () =>
            HttpResponse.json({
               ...runningRun,
               status: 'cancelled',
               completedAt: '2026-09-18T12:00:00Z',
            })
         ),
         http.post('*/api/v1/issues/:id/runs', () => HttpResponse.json(retried))
      );
   },
} satisfies Meta<typeof ExecutionLog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RunningAndFailed: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Running now')).toBeInTheDocument();
      await expect(canvas.getByText('1 past run')).toBeInTheDocument();
      // The failure's reason is on the row, not behind a click.
      await expect(
         canvas.getByText('Failed: Migration 061 collided with an applied checksum.')
      ).toBeInTheDocument();
   },
};

export const NoRuns: Story = {
   args: { runs: [] },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No runs yet.')).toBeInTheDocument();
   },
};

export const CancelTheRunningOne: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('button', { name: 'Cancel the run' }));
      await waitFor(() =>
         expect(args.onRunsChanged).toHaveBeenCalledWith(
            expect.objectContaining({ id: runningRun.id, status: 'cancelled' })
         )
      );
   },
};

export const RetryTheFailedOne: Story = {
   args: { runs: [failedRun] },
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Run again' }));
      await waitFor(() =>
         expect(args.onRunsChanged).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'run-42-3' })
         )
      );
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('A new run started.')).toBeVisible();
   },
};

export const InReviewLatestOutcome: Story = {
   args: {
      issueId: approvalsInbox.id,
      issueRef: approvalsInbox.identifier,
      inReview: true,
      runs: [deliveredRun],
   },
   play: async ({ canvas }) => {
      // The delivered run is lifted above the log while a person decides.
      await expect(canvas.getByText(/Frontend Engineer delivered/)).toBeInTheDocument();
   },
};
