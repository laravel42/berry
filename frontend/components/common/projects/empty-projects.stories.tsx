import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useCreateProjectStore } from '@/store/create-project-store';
import { EmptyProjects } from './empty-projects';

const meta = {
   component: EmptyProjects,
   tags: ['ai-generated'],
   beforeEach: () => {
      useCreateProjectStore.setState({ isOpen: false });
   },
} satisfies Meta<typeof EmptyProjects>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.getByRole('heading', { name: 'No projects yet.' })).toBeVisible();
      // The call to action opens the create-project dialog through its store.
      await userEvent.click(canvas.getByRole('button', { name: 'Create a project' }));
      await expect(useCreateProjectStore.getState().isOpen).toBe(true);
   },
};
