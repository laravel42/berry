import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import type { Project } from '@/data/projects';
import { useProjectsStore } from '@/store/projects-store';
import { ProjectContextMenuContent } from './project-context-menu';
import { projectHealth, seedProjectStores } from './stories-fixtures';

/** A row-shaped target; the menu is what a right-click on it opens. */
function RowWithMenu({ project }: { project: Project }) {
   return (
      <ContextMenu>
         <ContextMenuTrigger asChild>
            <div className="flex h-11 w-[480px] items-center border px-4">
               <span>{project.name}</span>
            </div>
         </ContextMenuTrigger>
         <ProjectContextMenuContent project={project} />
      </ContextMenu>
   );
}

const meta = {
   component: RowWithMenu,
   tags: ['ai-generated'],
   args: { project: projectHealth },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: ({ msw }) => {
      seedProjectStores();
      msw.use(http.delete('*/api/v1/projects/:id', () => new HttpResponse(null, { status: 204 })));
   },
} satisfies Meta<typeof RowWithMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.pointer({
         keys: '[MouseRight]',
         target: canvas.getByText(projectHealth.name),
      });
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('menuitem', { name: /Open in a new tab/ })).toBeVisible();
      await expect(body.getByRole('menuitem', { name: /^Pin/ })).toBeVisible();
      await expect(body.getByRole('menuitem', { name: /Copy link/ })).toBeVisible();
      await expect(body.getByRole('menuitem', { name: /Delete/ })).toBeVisible();
   },
};

/** Status, priority and health submenus check the project's current value. */
export const CurrentValuesChecked: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.pointer({
         keys: '[MouseRight]',
         target: canvas.getByText(projectHealth.name),
      });
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: /Status/ }));
      await expect(await body.findByRole('menuitemradio', { name: /Active/ })).toHaveAttribute(
         'aria-checked',
         'true'
      );
      await userEvent.click(await body.findByRole('menuitem', { name: /Priority/ }));
      await expect(await body.findByRole('menuitemradio', { name: /High/ })).toHaveAttribute(
         'aria-checked',
         'true'
      );
      await userEvent.click(await body.findByRole('menuitem', { name: /Health/ }));
      await expect(await body.findByRole('menuitemradio', { name: /On track/ })).toHaveAttribute(
         'aria-checked',
         'true'
      );
   },
};

/** Picking a different status from the submenu writes straight to the store. */
export const SetStatusFromSubmenu: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.pointer({
         keys: '[MouseRight]',
         target: canvas.getByText(projectHealth.name),
      });
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: /Status/ }));
      // A synthetic pointer click on a Radix submenu item closes the menu
      // without selecting, so the item is chosen the keyboard way.
      (await body.findByRole('menuitemradio', { name: /Planned/ })).focus();
      await userEvent.keyboard('{Enter}');
      await waitFor(() =>
         expect(useProjectsStore.getState().getProjectById(projectHealth.id)?.status.id).toBe(
            'to-do'
         )
      );
   },
};

/** Delete asks first, through the confirmation every project delete entry point shares. */
export const DeleteAsksFirst: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.pointer({
         keys: '[MouseRight]',
         target: canvas.getByText(projectHealth.name),
      });
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: /Delete/ }));
      await expect(await body.findByText(`Delete ${projectHealth.name}?`)).toBeVisible();
   },
};
