import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import type { Project } from '@/data/projects';
import { projectCreateStatusOptions } from './create-project/project-status-options';
import ProjectsBoard, { type ProjectBoardEntry } from './projects-board';
import { projectHealth, projectRunner, seedProjectStores, storyProjects } from './stories-fixtures';

/** Status columns, built the way the Projects page builds them. */
function statusEntries(shown: Project[], all: Project[] = storyProjects): ProjectBoardEntry[] {
   return projectCreateStatusOptions.map((option) => {
      const Icon = option.status.icon;
      return {
         group: { id: option.status.id, name: option.label, icon: <Icon />, status: option.status },
         projects: shown.filter((project) => project.status.id === option.status.id),
         total: all.filter((project) => project.status.id === option.status.id).length,
      };
   });
}

const meta = {
   component: ProjectsBoard,
   tags: ['ai-generated', 'needs-work'],
   args: {
      entries: statusEntries(storyProjects),
      totalCount: storyProjects.length,
      filteredCount: storyProjects.length,
      showEmptyGroups: false,
      empty: false,
   },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: () => {
      seedProjectStores();
   },
   decorators: [
      (Story) => (
         <div className="h-[560px] w-[1400px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ProjectsBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty columns (Cancelled) are left out unless asked for. */
export const Default: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Active')).toBeVisible();
      await expect(canvas.queryByText('Cancelled')).not.toBeInTheDocument();
   },
};

export const ShowEmptyColumns: Story = {
   args: { showEmptyGroups: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Cancelled')).toBeVisible();
   },
};

/**
 * Filters active (a search in the URL): emptied columns collapse into
 * "Hidden columns", and the footer counts what the filters hide.
 */
export const Filtered: Story = {
   args: {
      entries: statusEntries([projectHealth, projectRunner]),
      filteredCount: 2,
   },
   parameters: { nuqs: { searchParams: { q: 'r' } } },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Hidden columns')).toBeVisible();
      await expect(canvas.getByText('3 projects hidden by filters')).toBeVisible();
   },
};

export const NoProjects: Story = {
   args: { entries: statusEntries([], []), totalCount: 0, filteredCount: 0, empty: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { name: 'No projects yet.' })).toBeVisible();
   },
};
