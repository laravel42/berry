import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { useDisplaySettingsStore } from '@/store/display-settings-store';
import { useViewStore } from '@/store/view-store';
import { seedSession, shellHandlers, workspaceRoute } from '../stories-fixtures';
import { DisplayOptions } from './display-options';

const meta = {
   component: DisplayOptions,
   tags: ['ai-generated', 'needs-work'],
   parameters: { nextjs: { navigation: workspaceRoute('/elian/tasks') } },
   decorators: [
      (Story) => (
         <div className="flex w-[480px] justify-end">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedSession();
      useViewStore.setState({ viewType: 'list' });
      useDisplaySettingsStore.setState(useDisplaySettingsStore.getInitialState());
      msw.use(...shellHandlers);
   },
} satisfies Meta<typeof DisplayOptions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Display' }));
      const body = within(canvasElement.ownerDocument.body);
      const layouts = within(await body.findByRole('group', { name: 'Layout' }));
      await expect(layouts.getByRole('button', { name: 'List' })).toHaveAttribute(
         'aria-pressed',
         'true'
      );
      // The layout is URL state as well as a stored preference.
      await userEvent.click(layouts.getByRole('button', { name: 'Board' }));
      await expect(layouts.getByRole('button', { name: 'Board' })).toHaveAttribute(
         'aria-pressed',
         'true'
      );
   },
};

/** The header variant used where a toolbar has no room for the word. */
export const IconOnly: Story = {
   args: { iconOnly: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Display' })).toBeVisible();
   },
};

export const MoreOptionsOpen: Story = {
   beforeEach: () => {
      useDisplaySettingsStore.setState({ moreOptionsOpen: true });
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Display' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('combobox', { name: 'Grouping' })).toBeVisible();
   },
};
