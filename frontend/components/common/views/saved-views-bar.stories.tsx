import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { usePinsStore } from '@/store/pins-store';
import { useSessionStore } from '@/store/session-store';
import { useViewsStore } from '@/store/views-store';
import { SavedViewsBar } from './saved-views-bar';
import { uiViews, viewHandlers, viewSession } from './view-fixtures';

const meta = {
   component: SavedViewsBar,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      nextjs: {
         navigation: {
            segments: [
               ['orgId', 'berry'],
               ['viewId', 'view-review'],
            ],
         },
      },
   },
   beforeEach: ({ msw }) => {
      useSessionStore.setState(viewSession);
      useViewsStore.setState({ views: uiViews });
      usePinsStore.setState({ pins: [], loaded: true });
      msw.use(...viewHandlers);
   },
} satisfies Meta<typeof SavedViewsBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Issue views as tabs (the project view is not one); the open one is marked. */
export const Tabs: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('link', { name: /In review/ })).toBeVisible();
      await expect(canvas.queryByRole('link', { name: /Active projects/ })).toBeNull();
   },
};

/** Past six tabs the rest go into a "More views" popover. */
export const Overflow: Story = {
   beforeEach: () => {
      useViewsStore.setState({
         views: [
            ...uiViews,
            ...['Sprint 12', 'Design debt', 'Flaky checks', 'Docs'].map((name, index) => ({
               ...uiViews[0]!,
               id: `view-extra-${index}`,
               name,
               icon: '◆',
            })),
         ],
      });
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'More views' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('dialog')).toHaveTextContent('Urgent and high');
   },
};

/** Hiding a view in Manage takes its tab away for this reader only. */
export const ManageViews: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Manage views' }));
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog', { name: 'Order and visibility' }));
      await userEvent.click(dialog.getByRole('switch', { name: 'Nobody on it' }));
      await expect(canvas.queryByRole('link', { name: /Nobody on it/ })).toBeNull();
   },
};
