import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Box } from 'lucide-react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { expect } from 'storybook/test';
import { useCreateProjectStore } from '@/store/create-project-store';
import { GroupProjects } from './group-projects';
import {
   projectBilling,
   projectHealth,
   projectRunner,
   projectStatus,
   seedProjectStores,
   storyProjects,
} from './stories-fixtures';

const active = projectStatus('in-progress');
const ActiveIcon = active.icon;

const meta = {
   component: GroupProjects,
   tags: ['ai-generated', 'needs-work'],
   args: {
      group: { id: active.id, name: 'Active', icon: <ActiveIcon />, status: active },
      projects: [projectHealth, projectRunner],
      count: 2,
   },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: () => {
      seedProjectStores();
   },
   decorators: [
      (Story) => (
         <DndProvider backend={HTML5Backend}>
            <div className="h-[520px]">
               <Story />
            </div>
         </DndProvider>
      ),
   ],
} satisfies Meta<typeof GroupProjects>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A status column: the "+" opens the create dialog preset to that status. */
export const StatusColumn: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Create project in Active' }));
      await expect(useCreateProjectStore.getState()).toMatchObject({
         isOpen: true,
         defaultStatus: expect.objectContaining({ id: 'in-progress' }),
      });
   },
};

export const Paused: Story = {
   args: {
      group: {
         id: 'paused',
         name: 'Paused',
         icon: (() => {
            const Icon = projectStatus('paused').icon;
            return <Icon />;
         })(),
         status: projectStatus('paused'),
      },
      projects: [projectBilling],
      count: 1,
   },
};

export const EmptyColumn: Story = { args: { projects: [], count: 0 } };

/** Grouping off: one neutral column with no status to drop into. */
export const AllProjects: Story = {
   args: {
      group: {
         id: 'all',
         name: 'All projects',
         icon: <Box className="size-4 text-muted-foreground" />,
      },
      projects: storyProjects,
      count: storyProjects.length,
   },
};
