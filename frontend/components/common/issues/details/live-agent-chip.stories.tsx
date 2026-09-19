import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor, within } from 'storybook/test';
import { LiveAgentChip } from './live-agent-chip';
import {
   deliveredRun,
   queuedRun,
   runEventsHandler,
   runningRun,
   seedIssuesWorkspace,
} from '../stories-fixtures';

const meta = {
   component: LiveAgentChip,
   tags: ['ai-generated', 'needs-work'],
   args: { run: runningRun, onRunChanged: fn() },
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
         runEventsHandler(4),
         http.post('*/api/v1/runs/:runId/cancel', () =>
            HttpResponse.json({
               ...runningRun,
               status: 'cancelled',
               completedAt: '2026-09-18T12:00:00Z',
            })
         )
      );
   },
} satisfies Meta<typeof LiveAgentChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Working: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Backend Engineer is working')).toBeInTheDocument();
      // Started 7m56s before the fixed "now"; tool calls arrive from the stream.
      await expect(canvas.getByText(/elapsed$/)).toBeInTheDocument();
      await expect(await canvas.findByText('4 tool calls')).toBeInTheDocument();
   },
};

export const Queued: Story = {
   args: { run: queuedRun },
   beforeEach: ({ msw }) => {
      msw.use(runEventsHandler(0));
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Frontend Engineer is queued')).toBeInTheDocument();
      await expect(canvas.queryByText(/elapsed$/)).toBeNull();
   },
};

export const StopTheRun: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Stop' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Stop this run?')).toBeVisible();
      await userEvent.click(body.getByRole('button', { name: 'Stop the run' }));
      await waitFor(() =>
         expect(args.onRunChanged).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'cancelled' })
         )
      );
   },
};

export const FinishedRunHidesChip: Story = {
   args: { run: deliveredRun },
   play: async ({ canvasElement }) => {
      await expect(canvasElement.querySelector('button')).toBeNull();
   },
};
