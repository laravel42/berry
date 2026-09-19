import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Link from 'next/link';
import { expect } from 'storybook/test';
import { NavigationProgress } from './navigation-progress';
import { workspaceRoute } from './stories-fixtures';

/**
 * The bar is absolute across the top of whatever holds it, as the shell's
 * canvas does, and only appears once a link that navigates is clicked.
 */
const meta = {
   component: NavigationProgress,
   tags: ['ai-generated', 'needs-work'],
   parameters: { nextjs: { navigation: workspaceRoute('/elian/tasks') } },
   decorators: [
      (Story) => (
         <div className="relative h-40 w-[480px] border bg-container p-6">
            <Story />
            <div className="flex gap-4">
               <Link href="/elian/projects" className="underline">
                  Projects
               </Link>
               <Link href="/elian/tasks" className="underline">
                  Tasks (this page)
               </Link>
            </div>
         </div>
      ),
   ],
} satisfies Meta<typeof NavigationProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('progressbar')).toBeNull();
   },
};

export const Navigating: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('link', { name: 'Projects' }));
      await expect(
         await canvas.findByRole('progressbar', { name: 'Loading the next page' })
      ).toBeInTheDocument();
   },
};

/** A link to where you already are loads nothing, so nothing shows. */
export const SamePage: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('link', { name: 'Tasks (this page)' }));
      await expect(canvas.queryByRole('progressbar')).toBeNull();
   },
};
