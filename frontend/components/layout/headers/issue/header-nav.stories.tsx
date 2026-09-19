import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import { useAgentsStore } from '@/store/agents-store';
import { useIssueRunsStore } from '@/store/issue-runs-store';
import { useIssuesStore } from '@/store/issues-store';
import { usePinsStore } from '@/store/pins-store';
import { useReviewsStore } from '@/store/reviews-store';
import {
   agents,
   issues,
   runningRun,
   seedSession,
   shellHandlers,
   workspaceRoute,
} from '../../stories-fixtures';
import HeaderNav from './header-nav';

const taskRoute = (key: string) => workspaceRoute(`/elian/issue/${key}`, [['issueId', key]]);

const meta = {
   component: HeaderNav,
   tags: ['ai-generated', 'needs-work'],
   parameters: { layout: 'fullscreen', nextjs: { navigation: taskRoute('BERR-42') } },
   beforeEach: ({ msw }) => {
      seedSession();
      useIssuesStore.getState().hydrateIssues(issues);
      useIssueRunsStore.setState(useIssueRunsStore.getInitialState());
      useAgentsStore.setState({ agents });
      usePinsStore.setState({ pins: [] });
      useReviewsStore.setState({ open: [] });
      msw.use(...shellHandlers);
   },
} satisfies Meta<typeof HeaderNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InAProject: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('link', { name: 'Berry Server' })).toHaveAttribute(
         'href',
         '/elian/project/proj-1/issues'
      );
      await expect(canvas.getByText('1 / 4')).toBeVisible();
      // The first task has nowhere to go up; down is the next one in the list.
      await expect(canvas.getByRole('link', { name: 'Next task' })).toHaveAttribute(
         'href',
         '/elian/issue/BERR-38'
      );
   },
};

/** An agent is on it: the live chip says who, and for how long. */
export const AgentWorking: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/issues/:id/runs', () =>
            HttpResponse.json({
               nodes: [runningRun],
               pageInfo: { hasNextPage: false, endCursor: null },
            })
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText(/Backend Engineer is working/)).toBeVisible();
   },
};

export const LastInList: Story = {
   parameters: { nextjs: { navigation: taskRoute('BERR-17') } },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('4 / 4')).toBeVisible();
      await expect(canvas.queryByRole('link', { name: 'Next task' })).toBeNull();
   },
};

export const WithoutProject: Story = {
   beforeEach: () => {
      useIssuesStore
         .getState()
         .hydrateIssues(issues.map((issue) => ({ ...issue, project: undefined })));
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No project')).toBeVisible();
   },
};
