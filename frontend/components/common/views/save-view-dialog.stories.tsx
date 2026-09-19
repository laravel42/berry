import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor, within } from 'storybook/test';
import { useSessionStore } from '@/store/session-store';
import { useViewsStore } from '@/store/views-store';
import { SaveViewDialog } from './save-view-dialog';
import { uiViews, viewHandlers, viewSession } from './view-fixtures';

const meta = {
   component: SaveViewDialog,
   tags: ['ai-generated', 'needs-work'],
   args: { open: true, onOpenChange: fn() },
   beforeEach: ({ msw }) => {
      useSessionStore.setState(viewSession);
      useViewsStore.setState({ views: uiViews });
      msw.use(...viewHandlers);
   },
} satisfies Meta<typeof SaveViewDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A new view: name it, share it, save; it joins the views store. */
export const CreateView: Story = {
   play: async ({ args, canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog', { name: 'Save as new view' }));
      const save = dialog.getByRole('button', { name: 'Save' });
      await expect(save).toBeDisabled();
      await userEvent.type(dialog.getByRole('textbox', { name: 'Name' }), 'Blocked on review');
      await userEvent.click(dialog.getByRole('switch', { name: 'Shared with the workspace' }));
      await userEvent.click(save);
      await expect(await body.findByText('View saved')).toBeVisible();
      await expect(args.onOpenChange).toHaveBeenCalledWith(false);
      await expect(useViewsStore.getState().views[0]?.name).toBe('Blocked on review');
   },
};

/** Editing sends the revision it read. */
export const EditView: Story = {
   args: { view: uiViews[1] },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog', { name: 'Edit view' }));
      await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Urgent and high');
      await expect(dialog.getByRole('switch')).toBeChecked();
   },
};

/** Somebody saved the same view first: the 409 says so instead of overwriting. */
export const EditConflict: Story = {
   args: { view: uiViews[0] },
   beforeEach: ({ msw }) => {
      msw.use(
         http.patch('*/api/v1/views/:id', () =>
            HttpResponse.json(
               {
                  error: {
                     code: 'REVISION_CONFLICT',
                     message: 'Stale revision',
                     requestId: 'req-6',
                  },
               },
               { status: 409 }
            )
         )
      );
   },
   play: async ({ args, canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog'));
      await userEvent.click(dialog.getByRole('button', { name: 'Save' }));
      await expect(
         await body.findByText('Someone else edited this view. Reload it before saving again.')
      ).toBeVisible();
      await waitFor(() => expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled());
      await expect(args.onOpenChange).not.toHaveBeenCalled();
   },
};

/** The list's `?filters=` and `?tab=` travel into the saved view. */
export const SaveCurrentFilters: Story = {
   parameters: {
      nuqs: {
         searchParams: {
            tab: 'assigned',
            filters: JSON.stringify([
               { columnId: 'status', type: 'option', operator: 'is any of', values: ['in-review'] },
               { columnId: 'priority', type: 'option', operator: 'is', values: ['high'] },
            ]),
         },
      },
   },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog', { name: 'Save as new view' }));
      await expect(dialog.getByText('2 filters will be saved')).toBeVisible();
      await expect(dialog.getByRole('combobox', { name: 'Scope' })).toHaveTextContent(
         'Assigned to me'
      );
   },
};
