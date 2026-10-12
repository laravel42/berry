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
      await expect(await body.findByRole('combobox', { name: 'Grouping' })).toBeVisible();
      await expect(await body.findByRole('combobox', { name: 'Ordering' })).toBeVisible();
   },
};

/** The header variant used where a toolbar has no room for the word. */
export const IconOnly: Story = {
   args: { iconOnly: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Display' })).toBeVisible();
   },
};

/** Board (cards) is a toolbar layout, not a Display change. */
export const CardsLayoutIsClean: Story = {
   beforeEach: ({ msw }) => {
      seedSession();
      useViewStore.setState({ viewType: 'grid' });
      useDisplaySettingsStore.setState(useDisplaySettingsStore.getInitialState());
      msw.use(...shellHandlers);
   },
   play: async ({ canvas }) => {
      const trigger = canvas.getByRole('button', { name: 'Display' });
      await expect(trigger.querySelector('.bg-status-warning')).toBeNull();
   },
};

/** A card-property toggle inside the popover is what marks Display. */
export const CardPropertyMarksDisplay: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Display' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('button', { name: 'Priority' }));
      await expect(
         canvas.getByRole('button', { name: 'Display' }).querySelector('.bg-status-warning')
      ).not.toBeNull();
   },
};
