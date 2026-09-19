import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';

import { makeProject } from '@/components/common/projects/stories-fixtures';
import { useProjectsStore } from '@/store/projects-store';

import { UsageProjectFilter } from './usage-project-filter';

const projects = [
   makeProject({ id: 'project-1', name: 'Berry' }),
   makeProject({ id: 'project-2', name: 'Plugin SDK' }),
   makeProject({ id: 'project-3', name: 'Marketing site' }),
];

const meta = {
   component: UsageProjectFilter,
   args: { projectId: null, onChange: fn() },
   beforeEach: () => {
      useProjectsStore.setState({ projects });
   },
   render: function Render(args) {
      const [projectId, setProjectId] = useState(args.projectId);
      return (
         <UsageProjectFilter
            projectId={projectId}
            onChange={(next) => {
               setProjectId(next);
               args.onChange(next);
            }}
         />
      );
   },
} satisfies Meta<typeof UsageProjectFilter>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every project by default, named for assistive tech as the property and its value. */
export const AllProjects: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('combobox', { name: 'Project: All projects' })).toBeVisible();
   },
};

/** Choosing a project reports its id and names it on the trigger. */
export const ChooseProject: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox'));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: 'Plugin SDK' }));
      await expect(args.onChange).toHaveBeenCalledWith('project-2');
      await expect(canvas.getByRole('combobox', { name: 'Project: Plugin SDK' })).toBeVisible();
   },
};

/** Search narrows the list; a query nothing matches says so. */
export const Search: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox'));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.type(await body.findByPlaceholderText('Search projects'), 'market');
      await waitFor(() =>
         expect(body.queryByRole('option', { name: 'Plugin SDK' })).not.toBeInTheDocument()
      );
      await expect(body.getByRole('option', { name: 'Marketing site' })).toBeVisible();
      await userEvent.clear(body.getByPlaceholderText('Search projects'));
      await userEvent.type(body.getByPlaceholderText('Search projects'), 'zzz');
      await expect(await body.findByText('No project matches.')).toBeVisible();
   },
};

/** "All projects" clears the filter back to the whole workspace. */
export const ClearToAll: Story = {
   args: { projectId: 'project-1' },
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox', { name: 'Project: Berry' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: 'All projects' }));
      await expect(args.onChange).toHaveBeenCalledWith(null);
   },
};
