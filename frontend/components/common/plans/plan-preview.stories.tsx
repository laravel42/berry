import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import type { PlanRecord } from '@/lib/plans';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';
import { useMembersStore } from '@/store/members-store';
import { usePlanStore } from '@/store/plan-store';
import { useProjectsStore } from '@/store/projects-store';
import { useSessionStore } from '@/store/session-store';
import {
   blockedPlan,
   compileFailedPlan,
   generatingPlan,
   pendingApprovalPlan,
   planAgents,
   planMembers,
   planProjects,
   readyPlan,
   readySession,
   startedPlan,
} from './plan-fixtures';
import PlanPreview from './plan-preview';

/** Serves one plan record at `GET /api/v1/plans/{id}`, whatever the id. */
const servePlan = (record: PlanRecord) =>
   http.get('*/api/v1/plans/:id', () => HttpResponse.json(record));

const meta = {
   component: PlanPreview,
   tags: ['ai-generated', 'needs-work'],
   args: { planId: readyPlan.id },
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: { segments: [['orgId', 'berry']] } },
   },
   beforeEach: ({ msw }) => {
      useSessionStore.setState(readySession);
      useAgentsStore.setState({ agents: planAgents });
      useMembersStore.setState({ members: planMembers });
      useProjectsStore.setState({ projects: planProjects });
      usePlanStore.setState({ records: {}, errors: {}, busy: {}, autoStart: {} });
      msw.use(servePlan(readyPlan));
   },
   decorators: [
      (Story) => (
         <div className="h-[760px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof PlanPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A valid plan: Start Plan goes to the server and says what happened. */
export const ReadyToStart: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         // The approved record keeps the id of the plan being viewed.
         http.post('*/api/v1/plans/:id/approve', () =>
            HttpResponse.json({ ...startedPlan, id: readyPlan.id })
         )
      );
   },
   play: async ({ canvas, userEvent }) => {
      await expect(
         await canvas.findByRole('heading', { name: 'Persist project health and weekly updates' })
      ).toBeVisible();
      await expect(canvas.getByText('2 milestones · 4 tasks · 2 approvals')).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'Start Plan' }));
      // The approved record replaces the draft: the actions go, the outcome shows.
      await expect(
         await canvas.findByText('Plan started · 4 tasks · 2 approvals created')
      ).toBeVisible();
      await expect(canvas.queryByRole('button', { name: 'Start Plan' })).toBeNull();
   },
};

export const Generating: Story = {
   args: { planId: generatingPlan.id },
   beforeEach: ({ msw }) => {
      msw.use(servePlan(generatingPlan));
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Working out what this needs…')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Start Plan' })).toBeDisabled();
   },
};

/** A blocked plan opens its questions on its own. */
export const BlockedOnQuestions: Story = {
   args: { planId: blockedPlan.id },
   beforeEach: ({ msw }) => {
      msw.use(servePlan(blockedPlan));
   },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(
         await body.findByRole('dialog', { name: 'Berry needs an answer' })
      ).toBeVisible();
   },
};

export const WaitingForAdmin: Story = {
   args: { planId: pendingApprovalPlan.id },
   beforeEach: ({ msw }) => {
      msw.use(servePlan(pendingApprovalPlan));
   },
};

/** A started plan tails what became of its tasks: routing, then each run. */
export const Started: Story = {
   args: { planId: startedPlan.id },
   beforeEach: ({ msw }) => {
      msw.use(
         servePlan(startedPlan),
         http.get('*/api/v1/plans/:id/events', () =>
            HttpResponse.json({
               nodes: [
                  {
                     id: 'ev-exec',
                     sequence: 9,
                     stage: 'execute',
                     outcome: 'ok',
                     detail: { assigned: 4, started: 2, unassigned: 0 },
                     occurredAt: '2026-09-18T11:50:05Z',
                  },
               ],
            })
         ),
         http.get('*/api/v1/issues/:issueId/runs', ({ params }) => {
            const issueId = String(params.issueId);
            const pageInfo = { hasNextPage: false, endCursor: null };
            if (issueId !== 'issue-101') return HttpResponse.json({ nodes: [], pageInfo });
            return HttpResponse.json({
               nodes: [
                  {
                     id: 'run-1',
                     issueId,
                     agentId: 'agent-1',
                     status: 'running',
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
                     createdAt: '2026-09-18T11:50:10Z',
                     startedAt: '2026-09-18T11:50:12Z',
                     completedAt: null,
                  },
               ],
               pageInfo,
            });
         })
      );
      // The created tasks are linked when the board already holds them.
      useIssuesStore.setState({
         issues: [
            {
               id: 'issue-101',
               identifier: 'BERR-101',
               title: 'Add project_health column and migration',
            },
            {
               id: 'issue-102',
               identifier: 'BERR-102',
               title: 'Expose PATCH /api/v1/projects/{id}/health',
            },
         ] as never,
      });
   },
   play: async ({ canvas }) => {
      const log = await canvas.findByRole('status', { name: 'Plan execution log' });
      await expect(await within(log).findByText('Routed · 4 assigned · 2 started')).toBeVisible();
      await expect(within(log).getByText('BERR-101')).toBeVisible();
      await expect(within(log).getByText(/running/)).toBeVisible();
      await expect(canvas.queryByRole('button', { name: 'View tasks' })).toBeNull();
      await expect(canvas.queryByRole('button', { name: 'Transcript' })).toBeNull();
   },
};

export const StartFailed: Story = {
   args: { planId: compileFailedPlan.id },
   beforeEach: ({ msw }) => {
      msw.use(servePlan(compileFailedPlan));
   },
};

export const NotFound: Story = {
   args: { planId: 'plan-missing' },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/plans/:id', () =>
            HttpResponse.json(
               { error: { code: 'NOT_FOUND', message: 'Plan not found', requestId: 'req-2' } },
               { status: 404 }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('alert')).toHaveTextContent('Plan not found');
   },
};
