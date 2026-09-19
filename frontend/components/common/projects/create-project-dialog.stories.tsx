import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { useCreateProjectStore } from '@/store/create-project-store';
import { useProjectsStore } from '@/store/projects-store';
import { CreateProjectDialog } from './create-project-dialog';
import {
   apiProject,
   apiRepositories,
   makeProject,
   maya,
   projectStatus,
   seedProjectStores,
} from './stories-fixtures';

const meta = {
   component: CreateProjectDialog,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: ({ msw }) => {
      seedProjectStores({ projects: [] });
      useCreateProjectStore.setState({ isOpen: true, defaultStatus: null });
      msw.use(
         http.get('*/api/v1/integrations/github/repositories', () =>
            HttpResponse.json(apiRepositories)
         ),
         http.post('*/api/v1/projects', async ({ request }) => {
            const body = (await request.json()) as { name: string };
            return HttpResponse.json(
               apiProject(
                  makeProject({ id: 'proj-new', name: body.name, status: projectStatus('to-do') })
               ),
               { status: 201 }
            );
         })
      );
   },
} satisfies Meta<typeof CreateProjectDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opened from the header: Planned, no priority, and no lead until one is chosen. */
export const Open: Story = {
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('dialog', { name: 'New project' });
      await expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeDisabled();
   },
};

/** Opened from a board column's "+": the column's status comes in preset. */
export const FromBoardColumn: Story = {
   beforeEach: () => {
      useCreateProjectStore.setState({ isOpen: true, defaultStatus: projectStatus('in-progress') });
   },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('dialog');
      await expect(within(dialog).getAllByRole('combobox')[0]).toHaveTextContent('Active');
   },
};

/** Name and lead are all it takes; the created project lands in the store. */
export const CreateProject: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('dialog');
      await userEvent.type(within(dialog).getByPlaceholderText('Project name'), 'Billing export');
      // A combobox takes no name from its content, so the lead chip is found by its text.
      const leadChip = within(dialog)
         .getAllByRole('combobox')
         .find((element) => element.textContent?.includes('Project lead'));
      await userEvent.click(leadChip!);
      await userEvent.click(await body.findByRole('option', { name: new RegExp(maya.name) }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));

      await expect(await body.findByText('Project created')).toBeVisible();
      await waitFor(() =>
         expect(useProjectsStore.getState().projects[0]).toMatchObject({
            name: 'Billing export',
            lead: maya,
         })
      );
      await expect(useCreateProjectStore.getState().isOpen).toBe(false);
   },
};

/** The server refused: the dialog stays open and says why. */
export const CreateFails: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/projects', () =>
            HttpResponse.json(
               { error: { code: 'FORBIDDEN', message: 'You cannot create projects here.' } },
               { status: 403 }
            )
         )
      );
   },
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('dialog');
      await userEvent.type(within(dialog).getByPlaceholderText('Project name'), 'Billing export');
      // A combobox takes no name from its content, so the lead chip is found by its text.
      const leadChip = within(dialog)
         .getAllByRole('combobox')
         .find((element) => element.textContent?.includes('Project lead'));
      await userEvent.click(leadChip!);
      await userEvent.click(await body.findByRole('option', { name: new RegExp(maya.name) }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
      await expect(await body.findByText('You cannot create projects here.')).toBeVisible();
      await expect(useCreateProjectStore.getState().isOpen).toBe(true);
   },
};
