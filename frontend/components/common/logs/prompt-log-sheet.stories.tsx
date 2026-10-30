import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, within } from 'storybook/test';
import type { PromptLogDetail } from '@/lib/logs';
import { PromptLogSheet } from './prompt-log-sheet';

const COMPLETION: PromptLogDetail = {
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
   system: 'You are Berry\u2019s triage assistant. Set a priority and say why in one sentence.',
   prompt: 'Triage BERR-44.',
   transcript: [],
   reach: null,
   jsonSchema: { type: 'object', properties: { priority: { type: 'string' } } },
   response: { text: '', structured: { priority: 'high' } },
   failureMessage: null,
   startedAt: '2026-09-18T08:02:00Z',
   completedAt: '2026-09-18T08:02:02Z',
   exchange: null,
};

const AGENT_RUN: PromptLogDetail = {
   id: 'log-2',
   kind: 'agent',
   purpose: 'agent run',
   agentName: 'Frontend Engineer',
   issueIdentifier: 'BERR-42',
   model: 'us.anthropic.claude-sonnet-5',
   status: 'running',
   structured: false,
   promptPreview: 'Add an empty state to the goals list.',
   inputTokens: 18_400,
   outputTokens: 900,
   costMicros: 52_000,
   durationMs: null,
   failureCode: null,
   createdAt: '2026-09-18T11:38:00Z',
   system: 'You are the Frontend Engineer for this workspace.',
   prompt: 'Add an empty state to the goals list.',
   transcript: [{ role: 'user', text: 'An earlier turn in this conversation.' }],
   reach: { tools: ['read_file', 'write_file'], mcpServers: [], skills: ['design-tokens'] },
   jsonSchema: null,
   response: null,
   failureMessage: null,
   startedAt: '2026-09-18T11:40:05Z',
   completedAt: null,
   exchange: null,
};

function handler(detail: PromptLogDetail) {
   return http.get('*/api/v1/logs/:workspaceId/prompts/:runId', () => HttpResponse.json(detail));
}

const meta = {
   component: PromptLogSheet,
   tags: ['ai-generated'],
   args: { workspaceId: 'ws-1', runId: 'log-1', onClose: fn() },
} satisfies Meta<typeof PromptLogSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A completion's prompt, system message and structured answer, opened whole. */
export const CompletionDetail: Story = {
   beforeEach: ({ msw }) => {
      msw.use(handler(COMPLETION));
   },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Triage')).toBeVisible();
      await expect(body.getByText('Succeeded')).toBeVisible();
      await expect(body.getByRole('dialog')).toBeVisible();
      await expect(body.getByText(/triage assistant/)).toBeVisible();
   },
};

/** An agent run: what its loop started from, not a model call Berry made itself. */
export const AgentRunDetail: Story = {
   args: { runId: 'log-2' },
   beforeEach: ({ msw }) => {
      msw.use(handler(AGENT_RUN));
   },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Frontend Engineer · BERR-42')).toBeVisible();
      await expect(
         body.getByText(/An agent run is a loop inside the runtime that calls the model many times/)
      ).toBeVisible();
      await expect(body.getByText(/read_file, write_file/)).toBeVisible();
   },
};

/** The call could not be read back. */
export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/logs/:workspaceId/prompts/:runId', () =>
            HttpResponse.json({ error: { code: 'INTERNAL', message: 'boom' } }, { status: 500 })
         )
      );
   },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('This call could not be loaded.')).toBeVisible();
   },
};
