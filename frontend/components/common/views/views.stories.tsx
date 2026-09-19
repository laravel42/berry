import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { usePinsStore } from '@/store/pins-store';
import { useSessionStore } from '@/store/session-store';
import { useViewsDisplayStore } from '@/store/views-display-store';
import { useViewsStore } from '@/store/views-store';
import { viewHandlers, viewSession } from './view-fixtures';
import Views from './views';

const meta = {
   component: Views,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: { pathname: '/berry/views', segments: [['orgId', 'berry']] } },
   },
   beforeEach: ({ msw }) => {
      useSessionStore.setState(viewSession);
      useViewsStore.setState({ views: [] });
      usePinsStore.setState({ pins: [], loaded: true });
      useViewsDisplayStore.setState({ ordering: 'name' });
      msw.use(...viewHandlers);
   },
   decorators: [
      (Story) => (
         <div className="h-[560px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof Views>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The workspace's issue views, loaded from the API and sorted by name. */
export const IssueViews: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(await canvas.findByText('Agent work in flight')).toBeVisible();
      await expect(canvas.queryByText('Active projects')).toBeNull();
      await userEvent.click(canvas.getByRole('button', { name: 'projects' }));
      await expect(await canvas.findByText('Active projects')).toBeVisible();
   },
};

/** Deleting asks first, then removes the row once the server agrees. */
export const DeleteAView: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Nobody on it menu' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Delete view' }));
      const confirm = within(
         await body.findByRole('alertdialog', { name: 'Delete Nobody on it?' })
      );
      await userEvent.click(confirm.getByRole('button', { name: 'Delete view' }));
      await waitFor(() => expect(canvas.queryByText('Nobody on it')).toBeNull());
   },
};

/** Ordering and the columns shown live in the display popover. */
export const DisplayOptions: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await canvas.findByText('In review');
      await userEvent.click(canvas.getByRole('button', { name: 'Display options' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Display properties')).toBeVisible();
   },
};

export const NoViews: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/views', () =>
            HttpResponse.json({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } })
         )
      );
   },
};
