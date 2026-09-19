import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { EmptyProjects } from './empty-projects';

const meta = {
   component: EmptyProjects,
   tags: ['ai-generated'],
} satisfies Meta<typeof EmptyProjects>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { name: 'No projects yet.' })).toBeVisible();
      await expect(canvas.queryByRole('button')).toBeNull();
   },
};
