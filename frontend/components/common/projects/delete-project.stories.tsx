import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { useEffect } from 'react';
import { expect, waitFor, within } from 'storybook/test';
import type { Project } from '@/data/projects';
import { useProjectsStore } from '@/store/projects-store';
import { DeleteProjectDialog, useProjectDeletion } from './delete-project';
import { projectHealth, projectInbox, seedProjectStores } from './stories-fixtures';

/** The hook and the dialog, wired the way a project row wires them, already asked. */
function DeletionHarness({ project }: { project: Project }) {
   const deletion = useProjectDeletion();
   const { request } = deletion;
   useEffect(() => {
      request(project);
   }, [project, request]);
   return <DeleteProjectDialog deletion={deletion} />;
}

const meta = {
   component: DeletionHarness,
   tags: ['ai-generated', 'needs-work'],
   args: { project: projectHealth },
   beforeEach: ({ msw }) => {
      seedProjectStores();
      msw.use(http.delete('*/api/v1/projects/:id', () => new HttpResponse(null, { status: 204 })));
   },
} satisfies Meta<typeof DeletionHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Linked tasks are counted, so the confirmation says what stays behind. */
export const WithLinkedTasks: Story = {
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('alertdialog');
      await expect(dialog).toHaveTextContent(`Delete ${projectHealth.name}?`);
      await expect(dialog).toHaveTextContent('5 tasks stay on the board without a project.');
   },
};

export const NoLinkedTasks: Story = { args: { project: projectInbox } };

export const Confirm: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('alertdialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await expect(await body.findByText(`${projectHealth.name} deleted`)).toBeVisible();
      await waitFor(() =>
         expect(useProjectsStore.getState().getProjectById(projectHealth.id)).toBeUndefined()
      );
   },
};

/** A failed delete keeps the dialog open with the reason, and the project stays. */
export const Fails: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.delete('*/api/v1/projects/:id', () =>
            HttpResponse.json(
               { error: { code: 'NOT_FOUND', message: 'Project not found' } },
               { status: 404 }
            )
         )
      );
   },
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('alertdialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await expect(await within(dialog).findByText(/could not be deleted/)).toBeVisible();
      await expect(useProjectsStore.getState().getProjectById(projectHealth.id)).toBeDefined();
   },
};
