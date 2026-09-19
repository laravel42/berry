import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';
import { useMembersStore } from '@/store/members-store';
import { useProjectsStore } from '@/store/projects-store';
import { useSessionStore } from '@/store/session-store';
import { useViewsStore } from '@/store/views-store';
import ViewDetails from './view-details';
import {
   uiViews,
   viewHandlers,
   viewIssues,
   viewProjects,
   viewSession,
   viewUser,
} from './view-fixtures';

const meta = {
   component: ViewDetails,
   tags: ['ai-generated', 'needs-work'],
   args: { viewId: 'view-review' },
   parameters: {
      layout: 'fullscreen',
      nextjs: {
         navigation: {
            pathname: '/berry/view/view-review',
            segments: [
               ['orgId', 'berry'],
               ['viewId', 'view-review'],
            ],
         },
      },
   },
   beforeEach: ({ msw }) => {
      useSessionStore.setState(viewSession);
      useViewsStore.setState({ views: uiViews });
      useIssuesStore.setState({ issues: viewIssues });
      useProjectsStore.setState({ projects: viewProjects });
      useMembersStore.setState({ members: [viewUser] });
      useAgentsStore.setState({ agents: [] });
      msw.use(...viewHandlers);
   },
   decorators: [
      (Story) => (
         <div className="h-[640px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ViewDetails>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An issue view narrows the loaded tasks to its filter; the facets come from the server. */
export const IssueView: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('2 tasks')).toBeVisible();
      await expect(await canvas.findByText('Persist project health to the database')).toBeVisible();
      await expect(canvas.queryByText('Write the Q3 changelog')).toBeNull();
   },
};

export const UnassignedView: Story = { args: { viewId: 'view-unassigned' } };

export const ProjectView: Story = { args: { viewId: 'view-projects' } };

/** Views not loaded yet: the page waits rather than calling the view missing. */
export const Loading: Story = {
   beforeEach: () => {
      useViewsStore.setState({ views: [] });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Loading tasks…')).toBeVisible();
   },
};
