import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { projectHealth, seedProjectStores } from '../stories-fixtures';
import { ProjectDetailsSection } from './project-details-section';

const meta = {
   component: ProjectDetailsSection,
   tags: ['ai-generated', 'needs-work'],
   args: { project: projectHealth },
   beforeEach: () => {
      seedProjectStores();
   },
   decorators: [
      (Story) => (
         <div className="w-[252px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ProjectDetailsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Andrea Lunelio')).toBeVisible();
      await expect(canvas.getByText('Created')).toBeVisible();
   },
};

/** A creator the roster does not know (or none recorded) reads "Unknown". */
export const UnknownCreator: Story = {
   args: { project: { ...projectHealth, createdById: null } },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Unknown')).toBeVisible();
   },
};
