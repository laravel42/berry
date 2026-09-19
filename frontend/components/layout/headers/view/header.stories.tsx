import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import type { View } from '@/data/views';
import { useIssuesStore } from '@/store/issues-store';
import { useProjectsStore } from '@/store/projects-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useViewsStore } from '@/store/views-store';
import {
   issues,
   labels,
   me,
   seedSession,
   serverProject,
   shellHandlers,
   webProject,
   workspaceRoute,
} from '../../stories-fixtures';
import Header from './header';

const frontendView: View = {
   id: 'view-1',
   name: 'Frontend in flight',
   description: 'Frontend tasks nobody has finished.',
   icon: '🎨',
   type: 'issue',
   owner: me,
   createdAt: '2026-09-01T09:00:00Z',
   updatedAt: '2026-09-15T09:00:00Z',
   filter: { labelIds: [labels.frontend.id], statusCategories: ['unstarted', 'started'] },
   visibility: 'workspace',
   revision: 2,
   savedFilters: [],
   display: { layout: 'list' },
};

const projectView: View = {
   ...frontendView,
   id: 'view-2',
   name: 'Projects at risk',
   icon: '🚧',
   type: 'project',
   filter: { statusCategories: ['started'] },
};

const viewRoute = (id: string) => workspaceRoute(`/elian/view/${id}`, [['viewId', id]]);

const meta = {
   component: Header,
   tags: ['ai-generated', 'needs-work'],
   parameters: { layout: 'fullscreen', nextjs: { navigation: viewRoute('view-1') } },
   beforeEach: ({ msw }) => {
      seedSession();
      useViewsStore.setState({ views: [frontendView, projectView] });
      useIssuesStore.getState().hydrateIssues(issues);
      useProjectsStore.setState({ projects: [serverProject, webProject] });
      useRightPanelStore.setState({ openPanel: null });
      msw.use(...shellHandlers);
   },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two frontend tasks are open (BERR-38 is in review, BERR-51 to do). */
export const TaskView: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('2 tasks')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Insights' })).toBeVisible();
   },
};

export const ProjectView: Story = {
   parameters: { nextjs: { navigation: viewRoute('view-2') } },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('2 projects')).toBeVisible();
      await expect(canvas.queryByRole('button', { name: 'Insights' })).toBeNull();
   },
};
