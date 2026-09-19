import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { expect } from 'storybook/test';
import { useProjectsDisplayStore } from '@/store/projects-display-store';
import { ProjectGrid } from './project-grid';
import {
   projectHealth,
   projectInbox,
   projectPatchHandler,
   projectRunner,
   projectStatus,
   seedProjectStores,
} from './stories-fixtures';

const meta = {
   component: ProjectGrid,
   tags: ['ai-generated', 'needs-work'],
   args: { project: projectHealth, columnStatus: projectStatus('in-progress') },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: ({ msw }) => {
      seedProjectStores();
      msw.use(projectPatchHandler);
   },
   decorators: [
      (Story) => (
         // A card is a drag source and target, as in a board column.
         <DndProvider backend={HTML5Backend}>
            <div
               className="w-[266px] rounded-lg p-1.5"
               style={{ backgroundColor: 'var(--board-column-body)' }}
            >
               <Story />
            </div>
         </DndProvider>
      ),
   ],
} satisfies Meta<typeof ProjectGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnTrack: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('link', { name: projectHealth.name })).toHaveAttribute(
         'href',
         `/berry/project/${projectHealth.id}/overview`
      );
      await expect(canvas.getByRole('button', { name: 'Health: On track' })).toBeVisible();
      await expect(canvas.getByText('60%')).toBeVisible();
   },
};

export const AtRisk: Story = { args: { project: projectRunner } };

export const NoTargetDate: Story = {
   args: {
      project: { ...projectInbox, targetDate: undefined },
      columnStatus: projectStatus('to-do'),
   },
};

/** Outside a status column (grouping off) the card cannot be dragged. */
export const NotDraggable: Story = { args: { columnStatus: undefined } };

/** Display properties turned off leave just the name and progress. */
export const MinimalProperties: Story = {
   beforeEach: () => {
      useProjectsDisplayStore.setState({
         displayProperties: {
            ...useProjectsDisplayStore.getState().displayProperties,
            priority: false,
            lead: false,
            health: false,
            targetDate: false,
         },
      });
   },
};
