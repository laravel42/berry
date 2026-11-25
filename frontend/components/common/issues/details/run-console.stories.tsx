import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { agentToUser } from '@/lib/agents';
import type { Issue } from '@/data/issues';
import { priorities } from '@/data/priorities';
import { status as statuses } from '@/data/status';
import type { RunEvent, RunRecord } from '@/lib/runs';
import { frontendAgent } from '@/components/common/agents/stories-fixtures';
import { useAgentsStore } from '@/store/agents-store';
import { useIssueRunsStore } from '@/store/issue-runs-store';
import { useIssuesStore } from '@/store/issues-store';
import { useRunConsoleStore } from '@/store/run-console-store';
import { RunConsole } from './run-console';

const statusById = (id: string) => statuses.find((entry) => entry.id === id)!;
const priorityById = (id: string) => priorities.find((entry) => entry.id === id)!;

function issue(id: string, statusId: string, assignee: Issue['assignee']): Issue {
   return {
      id,
      identifier: 'BERR-99',
      title: 'Add an empty state to the goals list',
      description: '',
      status: statusById(statusId),
      assignee,
      priority: priorityById('high'),
      labels: [],
      createdAt: '2026-09-18T09:00:00Z',
      updatedAt: '2026-09-18T11:40:00Z',
      cycleId: '',
      rank: 'a3c',
      sortOrder: 0,
   };
}

function run(id: string, issueId: string, overrides: Partial<RunRecord>): RunRecord {
   return {
      id,
      issueId,
      agentId: frontendAgent.id,
      status: 'running',
      kind: 'agent',
      purpose: null,
      sequence: 500,
      summary: null,
      usage: {
         inputTokens: 1_200,
         outputTokens: 300,
         totalTokens: 1_500,
         costMicros: 6_000,
         currency: 'USD',
      },
      failure: null,
      source: 'assignment',
      requestedBy: null,
      createdAt: '2026-09-18T11:38:00Z',
      startedAt: '2026-09-18T11:40:00Z',
      completedAt: null,
      ...overrides,
   };
}

function event(
   id: string,
   runId: string,
   sequence: number,
   type: string,
   payload: unknown
): RunEvent {
   return { id, type, occurredAt: '2026-09-18T11:40:10Z', runId, sequence, payload };
}

/** Resets the task's own zustand stores, which are module singletons shared across stories. */
function seedConsoleStores(issues: Issue[], runsByIssue: Record<string, RunRecord[]>) {
   useIssuesStore.getState().hydrateIssues(issues);
   useAgentsStore.getState().hydrateAgents([frontendAgent]);
   useIssueRunsStore.setState({ byIssue: runsByIssue, loading: {} });
   useRunConsoleStore.setState({ chosen: {}, request: 0, openIssueId: null });
}

/** Every run's events endpoint: the page `RunTranscript` asks for, and an empty tail for the live follow. */
function runEventHandlers(eventsByRun: Record<string, RunEvent[]>) {
   return [
      http.get('*/api/v1/runs/:id/events', ({ request, params }) => {
         const url = new URL(request.url);
         const events = eventsByRun[String(params.id)] ?? [];
         if (url.searchParams.has('before')) {
            return HttpResponse.json({ events, cursor: null });
         }
         return new HttpResponse('', { headers: { 'content-type': 'text/event-stream' } });
      }),
   ];
}

const RUNNING = run('run-console-running', 'issue-console-1', { status: 'running' });
const SUCCEEDED = run('run-console-done', 'issue-console-3', {
   status: 'succeeded',
   startedAt: '2026-09-18T08:02:10Z',
   completedAt: '2026-09-18T08:09:45Z',
});

const RUNNING_EVENTS: RunEvent[] = [
   event('evt-1', RUNNING.id, 1, 'run.started', {}),
   event('evt-2', RUNNING.id, 2, 'run.output.delta', {
      text: 'Reading the goals list component before changing it.',
   }),
];
const SUCCEEDED_EVENTS: RunEvent[] = [
   event('evt-3', SUCCEEDED.id, 1, 'run.started', {}),
   event('evt-4', SUCCEEDED.id, 2, 'run.command.started', {
      commandId: 'cmd-1',
      command: 'pnpm lint',
   }),
   event('evt-5', SUCCEEDED.id, 3, 'run.command.output', {
      commandId: 'cmd-1',
      text: '✔ No problems found.\n',
   }),
   event('evt-6', SUCCEEDED.id, 4, 'run.command.completed', { commandId: 'cmd-1', exitCode: 0 }),
   event('evt-7', SUCCEEDED.id, 5, 'run.completed', {}),
];

const meta = {
   component: RunConsole,
   tags: ['ai-generated'],
   args: { issueId: 'issue-console-1' },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/issues/:id/runs', ({ params }) =>
            HttpResponse.json({
               nodes: [RUNNING, SUCCEEDED].filter((entry) => entry.issueId === params.id),
               pageInfo: { hasNextPage: false, endCursor: null },
            })
         ),
         http.get('*/api/v1/runs/:id', ({ params }) =>
            HttpResponse.json(
               [RUNNING, SUCCEEDED].find((entry) => entry.id === params.id) ?? RUNNING
            )
         ),
         ...runEventHandlers({
            [RUNNING.id]: RUNNING_EVENTS,
            [SUCCEEDED.id]: SUCCEEDED_EVENTS,
         })
      );
      seedConsoleStores([issue('issue-console-1', 'in-progress', agentToUser(frontendAgent))], {
         'issue-console-1': [RUNNING],
      });
   },
} satisfies Meta<typeof RunConsole>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Folded over the task: a live run pulses the console button rather than taking over the pane. */
export const FoldedLive: Story = {
   play: async ({ canvas }) => {
      const button = await canvas.findByRole('button', { name: /Console/ });
      await expect(button).toBeVisible();
      await expect(within(button).getByLabelText('Frontend Engineer')).toBeVisible();
   },
};

/** No run yet, but the task is an agent's and in a restartable state: the console offers to start it instead of folding empty. */
export const IdleRestartable: Story = {
   args: { issueId: 'issue-console-2' },
   beforeEach: () => {
      seedConsoleStores([issue('issue-console-2', 'to-do', agentToUser(frontendAgent))], {
         'issue-console-2': [],
      });
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('button', { name: 'Restart' })).toBeVisible();
      await expect(canvas.queryByRole('button', { name: /Console/ })).toBeNull();
   },
};

/** Opened by hand: the full console covers the pane and follows the task's live run. */
export const OpenLiveTranscript: Story = {
   play: async ({ canvas, canvasElement }) => {
      await (await canvas.findByRole('button', { name: /Console/ })).click();
      const section = within(canvasElement).getByRole('region', { name: 'Console' });
      await waitFor(() =>
         expect(
            within(section).getByText('Reading the goals list component before changing it.')
         ).toBeVisible()
      );
      await expect(within(section).getByRole('button', { name: 'Stop' })).toBeVisible();
   },
};

/** Stopping a live run asks first, because a stop cannot be taken back. */
export const StopConfirmation: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/runs/:id/cancel', ({ params }) =>
            HttpResponse.json({ ...RUNNING, id: String(params.id), status: 'cancelled' })
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await (await canvas.findByRole('button', { name: /Console/ })).click();
      const section = within(canvasElement).getByRole('region', { name: 'Console' });
      await userEvent.click(within(section).getByRole('button', { name: 'Stop' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Stop this run?')).toBeVisible();
      await userEvent.click(body.getByRole('button', { name: 'Stop the run' }));
      await waitFor(() => expect(body.queryByRole('alertdialog')).toBeNull());
   },
};
