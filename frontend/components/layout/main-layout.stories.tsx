import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { useSessionStore } from '@/store/session-store';
import GoalsHeader from './headers/goals/header';
import MainLayout from './main-layout';
import { workspaceRoute } from './stories-fixtures';

const pageBody = (
   <div className="mx-auto flex max-w-2xl flex-col gap-3 px-6 py-8">
      <h2>Ship the inbox</h2>
      <p className="text-muted-foreground">
         Approvals and proposals move into the inbox; the rail loses two entries.
      </p>
   </div>
);

const meta = {
   component: MainLayout,
   tags: ['ai-generated', 'needs-work'],
   args: { header: <GoalsHeader />, children: pageBody },
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/goals') },
   },
   decorators: [
      (Story) => (
         <div className="h-[520px]">
            <Story />
         </div>
      ),
   ],
   // Left signed out, so the workspace hydrator it mounts stays idle.
   beforeEach: () => {
      useSessionStore.setState({ status: 'anonymous', user: null, workspace: null });
   },
} satisfies Meta<typeof MainLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithHeader: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { name: 'Goals' })).toBeVisible();
      await expect(canvas.getByRole('heading', { name: 'Ship the inbox' })).toBeVisible();
   },
};

export const WithoutHeader: Story = {
   args: { header: undefined },
};

/** The layout mounts the command palette, which ⌘K opens from anywhere. */
export const CommandPaletteShortcut: Story = {
   play: async ({ canvasElement, userEvent }) => {
      await userEvent.keyboard('{Meta>}k{/Meta}');
      const body = within(canvasElement.ownerDocument.body);
      await expect(
         await body.findByPlaceholderText('Search tasks, pages and commands…')
      ).toBeVisible();
   },
};
