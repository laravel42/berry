import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { expect, waitFor } from 'storybook/test';
import { useProjectUpdatesStore } from '@/store/project-updates-store';
import { useProjectsStore } from '@/store/projects-store';
import {
   apiProject,
   apiProjectUpdates,
   apiRepositories,
   projectHealth,
   projectInbox,
   projectPatchHandler,
   seedProjectStores,
} from '../stories-fixtures';
import ProjectOverview from './project-overview';

const meta = {
   component: ProjectOverview,
   tags: ['ai-generated', 'needs-work'],
   args: { projectId: projectHealth.id },
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: { segments: [['orgId', 'berry']] } },
   },
   beforeEach: ({ msw }) => {
      seedProjectStores({ sessionReady: true });
      useProjectUpdatesStore.setState({ updatesByProject: {} });
      const posted: (typeof apiProjectUpdates.nodes)[number][] = [];
      msw.use(
         projectPatchHandler,
         // Like the server: a posted update is in the next read, so the feed's
         // refetch (it reloads whenever the project changes) keeps it.
         http.get('*/api/v1/projects/:id/updates', () =>
            HttpResponse.json({
               ...apiProjectUpdates,
               nodes: [...posted, ...apiProjectUpdates.nodes],
            })
         ),
         http.get('*/api/v1/integrations/github/repositories', () =>
            HttpResponse.json(apiRepositories)
         ),
         http.post('*/api/v1/projects/:id/updates', async ({ params, request }) => {
            const body = (await request.json()) as { body: string; health: string };
            const created = {
               id: 'upd-3',
               projectId: String(params.id),
               body: body.body,
               health: body.health,
               author: { type: 'user', id: 'user-1', name: 'Andrea Lunelio', avatarUrl: null },
               createdAt: '2026-09-18T12:00:00Z',
               updatedAt: '2026-09-18T12:00:00Z',
            };
            posted.unshift(created);
            return HttpResponse.json(created, { status: 201 });
         })
      );
   },
   decorators: [
      (Story) => (
         // The task list rows are drag sources.
         <DndProvider backend={HTML5Backend}>
            <div className="h-[860px] w-full">
               <Story />
            </div>
         </DndProvider>
      ),
   ],
} satisfies Meta<typeof ProjectOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText(/Updates API is merged/)).toBeVisible();
   },
};

/** A planned project with no tasks and no updates yet. */
export const JustCreated: Story = {
   args: { projectId: projectInbox.id },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/projects/:id/updates', () =>
            HttpResponse.json({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } })
         )
      );
   },
};

/** Not listed in this tab yet: the page reads the project itself. */
export const LoadedFromApi: Story = {
   beforeEach: ({ msw }) => {
      useProjectsStore.setState({ projects: [] });
      msw.use(
         http.get('*/api/v1/projects/:id', () => HttpResponse.json(apiProject(projectHealth)))
      );
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByRole('textbox', { name: 'Project description' })
      ).toBeVisible();
   },
};

/** Posting an update (Cmd/Ctrl+Enter or the button) adds it to the feed. */
export const PostUpdate: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.type(
         canvas.getByRole('textbox', { name: 'Project update' }),
         'Backfill is running on staging.'
      );
      await userEvent.click(canvas.getByRole('button', { name: 'post update' }));
      await waitFor(() =>
         expect(useProjectUpdatesStore.getState().updatesByProject[projectHealth.id]?.[0]?.id).toBe(
            'upd-3'
         )
      );
      await expect(canvas.getByRole('textbox', { name: 'Project update' })).toHaveValue('');
      await expect(await canvas.findByText('Backfill is running on staging.')).toBeVisible();
   },
};
