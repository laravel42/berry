import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor } from 'storybook/test';

import {
   dashboard,
   errorEnvelope,
   quietDashboard,
   seedAdminSession,
   usageHandlers,
} from './stories-fixtures';
import UsageNow from './usage-now';

/** Every `projectId` the live read was asked for, in order. */
const projectRequests: Array<string | null> = [];

const meta = {
   component: UsageNow,
   args: { query: { projectId: null } },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'elian']] } } },
   beforeEach: ({ msw }) => {
      seedAdminSession();
      msw.use(...usageHandlers);
   },
   decorators: [
      (Story) => (
         <div className="w-[1100px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof UsageNow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A busy workspace: urgency bands first, then in-flight and task distribution. */
export const Busy: Story = {
   play: async ({ canvas }) => {
      const run = await canvas.findByRole('link', {
         name: 'ELI-42 Persist project health to the database',
      });
      await expect(run).toHaveAttribute('href', '/elian/runs?run=run-301');
      // Urgency stack: needs a person leads, then failures, then spend.
      await expect(canvas.getByRole('heading', { name: 'Needs a person' })).toBeVisible();
      await expect(
         canvas.getByRole('heading', { name: 'Needs a person' }).nextElementSibling
      ).toHaveTextContent('7');
      await expect(canvas.getByRole('heading', { name: 'Recent failures' })).toBeVisible();
      await expect(
         canvas.getByRole('heading', { name: 'Spent today' }).nextElementSibling
      ).toHaveTextContent('$2.41');
      // In flight: running for a while, then the queue, each by task key.
      await expect(canvas.getByRole('link', { name: /^ELI-63 / })).toBeVisible();
      await expect(canvas.getAllByText(/^queued /).map((node) => node.textContent)).toEqual([
         'queued 3 minutes ago',
         'queued 1 minute ago',
      ]);
      await expect(canvas.getByText('running 19 min')).toBeVisible();
      // Recently finished: a failure names its code.
      await expect(canvas.getByText('RUNTIME_TIMEOUT')).toBeVisible();
      // Needs a person: approvals and reviews, each with a way to the rest.
      await expect(canvas.getByRole('heading', { name: '3 approvals' })).toBeVisible();
      await expect(canvas.getByRole('link', { name: /1 more · Open the inbox/ })).toHaveAttribute(
         'href',
         '/elian/inbox'
      );
      await expect(canvas.getByRole('heading', { name: '4 tasks in review' })).toBeVisible();
      await expect(canvas.getByRole('link', { name: /ELI-50/ })).toHaveAttribute(
         'href',
         '/elian/issue/ELI-50'
      );
      await expect(canvas.getByText('high risk')).toBeVisible();
      await expect(canvas.getByRole('img', { name: 'Tasks by status' })).toBeVisible();
      await expect(canvas.getByText('In review').parentElement).toHaveTextContent(
         String(dashboard.taskSnapshot.inReview)
      );
      // Only the live part of the old dashboard: no spend, no failures list.
      await expect(canvas.queryByText('Cost by day')).not.toBeInTheDocument();
      await expect(canvas.queryByText('Failures by agent')).not.toBeInTheDocument();
   },
};

/** Nothing running: the list says so, and statuses the snapshot omits read as 0. */
export const Quiet: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/dashboard/:workspaceId/overview', () =>
            HttpResponse.json(quietDashboard)
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('No agent is running.')).toBeVisible();
      await expect(canvas.getByText('No run has finished yet.')).toBeVisible();
      await expect(canvas.getByText('Nothing is waiting on a person.')).toBeVisible();
      await expect(canvas.getByText('Done').parentElement).toHaveTextContent('0');
   },
};

/** The read is narrowed by project, and not by the time range. */
export const ForAProject: Story = {
   args: { query: { projectId: 'project-9' } },
   beforeEach: ({ msw }) => {
      projectRequests.length = 0;
      msw.use(
         http.get('*/api/v1/dashboard/:workspaceId/overview', ({ request }) => {
            projectRequests.push(new URL(request.url).searchParams.get('projectId'));
            return HttpResponse.json(quietDashboard);
         })
      );
   },
   play: async ({ canvas }) => {
      await canvas.findByText('No agent is running.');
      await waitFor(() => expect(projectRequests).toContain('project-9'));
   },
};

export const Failed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/dashboard/:workspaceId/overview', () =>
            errorEnvelope(503, 'UNAVAILABLE', 'Live activity is temporarily unavailable.')
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('Live activity is temporarily unavailable.')
      ).toBeVisible();
   },
};
