import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import type { RunRecord } from '@/lib/runs';
import { RunTab } from './run-entry';

function run(overrides: Partial<RunRecord>): RunRecord {
   return {
      id: 'run-1',
      issueId: 'issue-1',
      agentId: 'agent-unknown',
      status: 'running',
      kind: 'agent',
      purpose: null,
      sequence: 1,
      summary: null,
      usage: {
         inputTokens: 0,
         outputTokens: 0,
         totalTokens: 0,
         costMicros: null,
         currency: null,
      },
      failure: null,
      source: 'assignment',
      requestedBy: null,
      createdAt: '2026-09-18T11:40:00Z',
      startedAt: '2026-09-18T11:40:00Z',
      completedAt: null,
      ...overrides,
   };
}

const meta = {
   component: RunTab,
   tags: ['ai-generated'],
   args: {
      run: run({}),
      runs: [run({})],
      selected: true,
      panelId: 'run-panel',
      onSelect: fn(),
   },
} satisfies Meta<typeof RunTab>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A run still going: live, pulsing, counted up from when it started to the fixed story clock. */
export const Running: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Run 1')).toBeVisible();
      await expect(canvas.getByText('running')).toBeVisible();
      await expect(canvas.getByText('20m 00s')).toBeVisible();
   },
};

/** A finished run: its duration is fixed between its start and completion, not counted further. */
export const Succeeded: Story = {
   args: {
      run: run({
         status: 'succeeded',
         startedAt: '2026-09-18T11:40:00Z',
         completedAt: '2026-09-18T11:47:30Z',
      }),
      runs: [run({ status: 'succeeded' })],
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('succeeded')).toBeVisible();
      await expect(canvas.getByText('7m 30s')).toBeVisible();
   },
};

/** A failed run: the status itself reads "failed", in the tab's own tone. */
export const Failed: Story = {
   args: {
      run: run({
         status: 'failed',
         startedAt: '2026-09-18T11:40:00Z',
         completedAt: '2026-09-18T11:41:00Z',
         failure: {
            code: 'RUNTIME_TIMEOUT',
            message: 'The runtime stopped answering.',
            retryable: true,
         },
      }),
      runs: [run({ status: 'failed' })],
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('failed')).toBeVisible();
      await expect(canvas.getByText('1m 00s')).toBeVisible();
   },
};
