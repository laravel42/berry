import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { expect } from 'storybook/test';
import { issuesFor, projectHealth, projectRunner, seedProjectStores } from '../stories-fixtures';
import { ProjectTasksSection } from './project-tasks-section';

const meta = {
   component: ProjectTasksSection,
   tags: ['ai-generated', 'needs-work'],
   args: { issues: issuesFor(projectHealth.id) },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: () => {
      seedProjectStores();
   },
   decorators: [
      (Story) => (
         // Task rows are drag sources wherever they are drawn.
         <DndProvider backend={HTML5Backend}>
            <div className="w-[720px]">
               <Story />
            </div>
         </DndProvider>
      ),
   ],
} satisfies Meta<typeof ProjectTasksSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Grouped by status in workflow order; empty statuses are skipped. */
export const GroupedByStatus: Story = {
   play: async ({ canvas }) => {
      // A task row draws its identifier more than once (row and drag preview).
      await expect(canvas.getAllByText('BERR-44')[0]).toBeVisible();
      await expect(canvas.queryByText('Blocked')).not.toBeInTheDocument();
   },
};

export const ReviewAndBlocked: Story = { args: { issues: issuesFor(projectRunner.id) } };

export const NoTasks: Story = {
   args: { issues: [] },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No tasks linked to this project yet.')).toBeVisible();
   },
};
