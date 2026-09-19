import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { ProjectPeekPanel } from './project-peek-panel';
import { projectHealth, projectInbox, seedProjectStores } from './stories-fixtures';

const meta = {
   component: ProjectPeekPanel,
   tags: ['ai-generated', 'needs-work'],
   args: { projectId: projectHealth.id, onClose: fn() },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: () => {
      seedProjectStores();
   },
   decorators: [
      (Story) => (
         // The panel floats over the right edge of the timeline.
         <div className="relative h-[820px] w-[900px] border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ProjectPeekPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Members and progress come from the project's linked tasks. */
export const WithTasks: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('link', { name: 'Open project' })).toHaveAttribute(
         'href',
         `/berry/project/${projectHealth.id}/overview`
      );
      await expect(canvas.getByText('3 members')).toBeVisible();
   },
};

/** No tasks yet: the members row offers to add some. */
export const NoTasks: Story = { args: { projectId: projectInbox.id } };

/** Escape closes it, as does the close button. */
export const CloseWithEscape: Story = {
   play: async ({ args, userEvent }) => {
      await userEvent.keyboard('{Escape}');
      await expect(args.onClose).toHaveBeenCalled();
   },
};
