import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { issues, serverProject, webProject } from '@/components/layout/stories-fixtures';
import { useIssuesStore } from '@/store/issues-store';
import { useProjectsStore } from '@/store/projects-store';
import { ProjectSelector } from './project-selector';

const meta = {
   component: ProjectSelector,
   tags: ['ai-generated', 'needs-work'],
   args: { project: undefined, onChange: fn() },
   beforeEach: () => {
      useIssuesStore.getState().hydrateIssues(issues);
      useProjectsStore.setState({ projects: [serverProject, webProject] });
   },
} satisfies Meta<typeof ProjectSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoProject: Story = {
   play: async ({ canvas, canvasElement, args, userEvent }) => {
      await expect(canvas.getByRole('combobox')).toHaveTextContent('No project');
      await userEvent.click(canvas.getByRole('combobox'));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /Berry Web/ }));
      await expect(args.onChange).toHaveBeenCalledWith(webProject);
   },
};

export const InAProject: Story = { args: { project: serverProject } };

/** A workspace with no projects yet. */
export const NoneToChoose: Story = {
   beforeEach: () => {
      useProjectsStore.setState({ projects: [] });
   },
};
