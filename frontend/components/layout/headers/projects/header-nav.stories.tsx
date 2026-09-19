import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useCreateProjectStore } from '@/store/create-project-store';
import { seedSession, workspaceRoute } from '../../stories-fixtures';
import HeaderNav from './header-nav';

const meta = {
   component: HeaderNav,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/projects') },
   },
   beforeEach: () => {
      seedSession('admin');
      useCreateProjectStore.setState({ isOpen: false });
   },
} satisfies Meta<typeof HeaderNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.getByRole('heading', { name: 'Projects' })).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: /project/i }));
      await expect(useCreateProjectStore.getState().isOpen).toBe(true);
   },
};

export const Narrow: Story = {
   decorators: [
      (Story) => (
         <div className="w-[360px] border">
            <Story />
         </div>
      ),
   ],
};
