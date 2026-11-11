import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor } from 'storybook/test';
import { projectHealth, projectPatchHandler, seedProjectStores } from '../stories-fixtures';
import { useProjectsStore } from '@/store/projects-store';
import { ProjectTitle } from './project-title';

const meta = {
   component: ProjectTitle,
   tags: ['ai-generated'],
   args: { project: projectHealth },
   beforeEach: ({ msw }) => {
      seedProjectStores();
      msw.use(projectPatchHandler);
   },
} satisfies Meta<typeof ProjectTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shows the project's name as a plain heading until it is clicked. */
export const ReadingView: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Edit the title' })).toHaveTextContent(
         'Persist project health'
      );
   },
};

/** Clicking opens an editable field, focused with the caret at the end. */
export const ClickToEdit: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Edit the title' }));
      const field = canvas.getByRole('textbox', { name: 'Edit the title' });
      await expect(field).toHaveFocus();
      await expect(field).toHaveValue('Persist project health');
   },
};

/** Enter commits the new name and saves it through the project patch route. */
export const EnterCommits: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Edit the title' }));
      const field = canvas.getByRole('textbox', { name: 'Edit the title' });
      await userEvent.clear(field);
      await userEvent.type(field, 'Persist project health v2{Enter}');
      // The heading itself stays on the `project` prop this story passed in;
      // the save is observed on the store the parent page re-renders from.
      await waitFor(() =>
         expect(useProjectsStore.getState().getProjectById(projectHealth.id)?.name).toBe(
            'Persist project health v2'
         )
      );
   },
};

/** An empty title is refused and the previous name comes back. */
export const EmptyTitleIsRefused: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Edit the title' }));
      const field = canvas.getByRole('textbox', { name: 'Edit the title' });
      await userEvent.clear(field);
      await field.blur();
      await waitFor(() =>
         expect(canvas.getByRole('button', { name: 'Edit the title' })).toHaveTextContent(
            'Persist project health'
         )
      );
   },
};

/** A save the server refuses puts the previous name back and says so. */
export const SaveFails: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.patch('*/api/v1/projects/:id', () => HttpResponse.json({}, { status: 500 })));
   },
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Edit the title' }));
      const field = canvas.getByRole('textbox', { name: 'Edit the title' });
      await userEvent.clear(field);
      await userEvent.type(field, 'A name that will not save{Enter}');
      await waitFor(() =>
         expect(useProjectsStore.getState().getProjectById(projectHealth.id)?.name).toBe(
            'Persist project health'
         )
      );
   },
};
