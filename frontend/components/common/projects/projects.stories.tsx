import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { useProjectsDisplayStore } from '@/store/projects-display-store';
import { useProjectsStore } from '@/store/projects-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import Projects from './projects';
import {
   apiRepositories,
   projectHealth,
   projectPatchHandler,
   projectRunner,
   seedProjectStores,
   storyProjects,
} from './stories-fixtures';
import { http, HttpResponse } from 'msw';

const meta = {
   component: Projects,
   tags: ['ai-generated', 'needs-work'],
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
         <div className="h-[720px] w-full min-w-[1320px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof Projects>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default list view, grouped by status. */
export const List: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getAllByRole('link')).toHaveLength(storyProjects.length);
   },
};

export const Board: Story = {
   beforeEach: () => {
      useProjectsDisplayStore.setState({ viewType: 'board' });
   },
};

export const WithInsights: Story = {
   beforeEach: () => {
      useRightPanelStore.setState({ openPanel: 'insights' });
   },
};

/** Searching narrows by name; a search that matches nothing says so. */
export const Search: Story = {
   play: async ({ canvas, userEvent }) => {
      const search = canvas.getByPlaceholderText('Search projects');
      await userEvent.type(search, 'runtime');
      await expect(await canvas.findByRole('link', { name: projectRunner.name })).toBeVisible();
      await expect(
         canvas.queryByRole('link', { name: projectHealth.name })
      ).not.toBeInTheDocument();
      await userEvent.clear(search);
      await userEvent.type(search, 'nothing like this');
      await expect(await canvas.findByText('No project matches these filters.')).toBeVisible();
   },
};

/** Selecting rows offers the one bulk action a project list has: pinning. */
export const SelectAndPin: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/pins', async ({ request }) => {
            const body = (await request.json()) as { targetId: string };
            return HttpResponse.json({
               id: `pin-${body.targetId}`,
               targetType: 'project',
               targetId: body.targetId,
               position: 0,
               title: projectHealth.name,
               identifier: null,
            });
         })
      );
   },
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('checkbox', { name: `Select ${projectHealth.name}` }));
      await expect(canvas.getByText('1 selected')).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'Pin selected' }));
      await expect(await canvas.findByRole('button', { name: 'Unpin' })).toBeInTheDocument();
   },
};

export const NoProjects: Story = {
   beforeEach: () => {
      useProjectsStore.setState({ projects: [] });
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await expect(canvas.getByRole('heading', { name: 'No projects yet.' })).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'New project' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('dialog', { name: 'New project' })).toBeVisible();
   },
};
