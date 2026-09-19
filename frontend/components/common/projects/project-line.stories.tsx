import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { useProjectsDisplayStore } from '@/store/projects-display-store';
import ProjectLine from './project-line';
import {
   projectBilling,
   projectHealth,
   projectInbox,
   projectPatchHandler,
   seedProjectStores,
} from './stories-fixtures';

const meta = {
   component: ProjectLine,
   tags: ['ai-generated', 'needs-work'],
   args: { project: projectHealth },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: ({ msw }) => {
      seedProjectStores();
      msw.use(projectPatchHandler);
   },
   decorators: [
      (Story) => (
         // Wide enough for the xl-only columns (lead, target date, tasks).
         <div className="w-[1320px] border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ProjectLine>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('link', { name: projectHealth.name })).toHaveAttribute(
         'href',
         `/berry/project/${projectHealth.id}/overview`
      );
      // Tasks column (xl and up): the five tasks linked to this project.
      await expect(canvas.getByText('5')).toBeInTheDocument();
   },
};

export const Planned: Story = { args: { project: projectInbox } };

export const Paused: Story = { args: { project: projectBilling } };

/** With selection on, the row carries a checkbox. */
export const Selectable: Story = {
   args: { selected: true, onToggleSelected: fn() },
   play: async ({ args, canvas, userEvent }) => {
      const box = canvas.getByRole('checkbox', { name: `Select ${projectHealth.name}` });
      await expect(box).toBeChecked();
      await userEvent.click(box);
      await expect(args.onToggleSelected).toHaveBeenCalledTimes(1);
   },
};

/** Labels are a display property, off by default. */
export const WithLabels: Story = {
   beforeEach: () => {
      useProjectsDisplayStore.getState().toggleDisplayProperty('labels');
   },
};

/** Delete sits behind the row menu and a confirmation. */
export const DeleteFromMenu: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: `${projectHealth.name} menu` }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Delete' }));
      await expect(await body.findByRole('alertdialog')).toHaveTextContent(
         `Delete ${projectHealth.name}?`
      );
   },
};
