import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { expect } from 'storybook/test';
import { useProjectsStore } from '@/store/projects-store';
import {
   apiRepositories,
   projectHealth,
   projectInbox,
   projectPatchHandler,
   seedProjectStores,
} from '../stories-fixtures';
import ProjectIssues from './project-issues';

const meta = {
   component: ProjectIssues,
   tags: ['ai-generated', 'needs-work'],
   args: { projectId: projectHealth.id },
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: { segments: [['orgId', 'berry']] } },
   },
   beforeEach: ({ msw }) => {
      seedProjectStores();
      msw.use(
         projectPatchHandler,
         http.get('*/api/v1/integrations/github/repositories', () =>
            HttpResponse.json(apiRepositories)
         )
      );
   },
   decorators: [
      (Story) => (
         <DndProvider backend={HTML5Backend}>
            <div className="h-[760px] w-full">
               <Story />
            </div>
         </DndProvider>
      ),
   ],
} satisfies Meta<typeof ProjectIssues>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The project's own tasks in the shared list, beside the properties panel. */
export const Default: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Add health column and migration')).toBeInTheDocument();
   },
};

export const NoTasks: Story = { args: { projectId: projectInbox.id } };

/** Session not ready and the project not in the store yet. */
export const Loading: Story = {
   beforeEach: () => {
      useProjectsStore.setState({ projects: [] });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Loading project…')).toBeVisible();
   },
};
