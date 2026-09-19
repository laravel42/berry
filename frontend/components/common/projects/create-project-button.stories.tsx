import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useCreateProjectStore } from '@/store/create-project-store';
import { CreateProjectButton } from './create-project-button';

const meta = {
   component: CreateProjectButton,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: () => {
      useCreateProjectStore.setState({ isOpen: false, defaultStatus: null });
   },
} satisfies Meta<typeof CreateProjectButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'New project' }));
      // Opened from the header, so no column status is carried in.
      await expect(useCreateProjectStore.getState()).toMatchObject({
         isOpen: true,
         defaultStatus: null,
      });
   },
};
