import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import { seedSession } from '@/components/common/agents/stories-fixtures';
import type { PromptLogDetail, PromptLogSummary } from '@/lib/logs';
import PromptLogs from './prompt-logs';

const ROW: PromptLogSummary = {
   id: 'log-1',
   kind: 'completion',
   purpose: 'Triage',
   agentName: null,
   issueIdentifier: null,
   model: 'us.anthropic.claude-sonnet-5',
   status: 'succeeded',
   structured: true,
   promptPreview: 'Triage BERR-44.',
   inputTokens: 1200,
   outputTokens: 80,
   costMicros: 4200,
   durationMs: 1800,
   failureCode: null,
   createdAt: '2026-09-18T08:02:00Z',
};

const DETAIL: PromptLogDetail = {
   ...ROW,
   system: 'You are Berry\u2019s triage assistant.',
   prompt: ROW.promptPreview,
   transcript: [],
   reach: null,
   jsonSchema: null,
   response: { text: '', structured: { priority: 'high' } },
   failureMessage: null,
   startedAt: ROW.createdAt,
   completedAt: '2026-09-18T08:02:02Z',
   exchange: null,
};

function handlers(rows: PromptLogSummary[]) {
   return [
      http.get('*/api/v1/logs/:workspaceId/purposes', () =>
         HttpResponse.json({ purposes: ['Triage'] })
      ),
      http.get('*/api/v1/logs/:workspaceId/prompts', () =>
         HttpResponse.json({ nodes: rows, pageInfo: { hasNextPage: false, endCursor: null } })
      ),
      http.get('*/api/v1/logs/:workspaceId/prompts/:runId', () => HttpResponse.json(DETAIL)),
   ];
}

const meta = {
   component: PromptLogs,
   tags: ['ai-generated'],
   beforeEach: () => {
      seedSession();
   },
} satisfies Meta<typeof PromptLogs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every model call, newest first: purpose, prompt, model, usage and status. */
export const WithRows: Story = {
   beforeEach: ({ msw }) => {
      msw.use(...handlers([ROW]));
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Triage')).toBeVisible();
      await expect(canvas.getByText('Triage BERR-44.')).toBeVisible();
      await expect(canvas.getByText('Claude Sonnet 5')).toBeVisible();
      await expect(canvas.getByText('Succeeded')).toBeVisible();
   },
};

/** Nothing logged yet. */
export const Empty: Story = {
   beforeEach: ({ msw }) => {
      msw.use(...handlers([]));
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText(
            'Nothing logged yet. Planning, triage, reviews, chat replies and agent runs show up here as they run.'
         )
      ).toBeVisible();
   },
};

/** The list could not be read. */
export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/logs/:workspaceId/purposes', () => HttpResponse.json({ purposes: [] })),
         http.get('*/api/v1/logs/:workspaceId/prompts', () =>
            HttpResponse.json({ error: { code: 'INTERNAL', message: 'boom' } }, { status: 500 })
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Logs could not be loaded.')).toBeVisible();
   },
};

/** Clicking a row opens its whole exchange in the detail sheet. */
export const OpenRow: Story = {
   beforeEach: ({ msw }) => {
      msw.use(...handlers([ROW]));
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      const cell = await canvas.findByText('Triage BERR-44.');
      await userEvent.click(cell.closest('tr')!);
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('triage assistant', { exact: false })).toBeVisible();
   },
};
