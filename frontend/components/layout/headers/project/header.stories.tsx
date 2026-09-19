import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { useIssuesStore } from '@/store/issues-store';
import { usePinsStore } from '@/store/pins-store';
import { useProjectsStore } from '@/store/projects-store';
import {
   issues,
   seedSession,
   serverProject,
   shellHandlers,
   webProject,
   workspaceRoute,
} from '../../stories-fixtures';
import Header from './header';

const meta = {
   component: Header,
   tags: ['ai-generated', 'needs-work'],
   args: { projectId: 'proj-1', listControls: false },
   parameters: {
      layout: 'fullscreen',
      nextjs: {
         navigation: workspaceRoute('/elian/project/proj-1/overview', [['projectId', 'proj-1']]),
      },
   },
   decorators: [
      (Story) => (
         <div className="flex w-full flex-col">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedSession();
      useProjectsStore.setState({ projects: [serverProject, webProject] });
      useIssuesStore.getState().hydrateIssues(issues);
      usePinsStore.setState({ pins: [] });
      msw.use(...shellHandlers);
   },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Berry Server')).toBeVisible();
      await expect(canvas.getByRole('link', { name: 'Projects' })).toHaveAttribute(
         'href',
         '/elian/projects'
      );
   },
};

/** The tasks tab adds the filter and display controls. */
export const TasksTab: Story = {
   args: { listControls: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Display' })).toBeVisible();
   },
};

export const ConfirmDelete: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Delete project' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('alertdialog')).toBeVisible();
   },
};

/** Not in the store and not fetched yet. */
export const Loading: Story = {
   args: { projectId: 'proj-404' },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Loading project…')).toBeVisible();
   },
};
