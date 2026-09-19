import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { getRouter } from '@storybook/nextjs-vite/navigation.mock';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';

import { seedAdminSession, usageHandlers } from '../usage/stories-fixtures';
import RuntimeDetail from './runtime-detail';
import { customDetail, platformDetail, profiles } from './stories-fixtures';

const meta = {
   component: RuntimeDetail,
   tags: ['ai-generated', 'needs-work'],
   args: { runtimeId: 'rt-platform' },
   parameters: {
      nextjs: { navigation: { segments: [['orgId', 'elian']] } },
   },
   beforeEach: ({ msw }) => {
      seedAdminSession();
      msw.use(
         ...usageHandlers,
         http.get('*/api/v1/runtimes/rt-platform', () => HttpResponse.json(platformDetail)),
         http.get('*/api/v1/runtimes/rt-gpu', () => HttpResponse.json(customDetail)),
         http.get('*/api/v1/runtimes/:runtimeId/profiles', ({ params }) =>
            HttpResponse.json({
               nodes: params.runtimeId === 'rt-platform' ? profiles : [],
               pageInfo: { hasNextPage: false, endCursor: null },
            })
         )
      );
   },
} satisfies Meta<typeof RuntimeDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The deployment's default runtime: healthy, busy, four agents bound to it. */
export const Platform: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('heading', { name: 'Berry platform' })).toBeVisible();
      await expect(canvas.getByRole('img', { name: 'Tasks per day' })).toBeVisible();
      await expect(canvas.getByText('Long sessions')).toBeVisible();
      // Platform runtimes have no visibility switch and cannot be deleted.
      await expect(canvas.queryByText('Danger zone')).toBeNull();
   },
};

/** A registered runtime the viewer owns: unreachable, private, deletable. */
export const OwnedCustom: Story = {
   args: { runtimeId: 'rt-gpu' },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText(/AccessDeniedException/)).toBeVisible();
      await expect(canvas.getByText('No tasks in the last 30 days.')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Workspace' })).toBeEnabled();
   },
};

/** Someone else's runtime: the visibility switch is shown but locked. */
export const SomeoneElsesCustom: Story = {
   args: { runtimeId: 'rt-gpu' },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/runtimes/rt-gpu', () =>
            HttpResponse.json({ ...customDetail, ownerId: 'user-2' })
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('Only the person who registered a runtime can change who sees it.')
      ).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Workspace' })).toBeDisabled();
   },
};

/** Delete is gated on the acknowledgement, then returns to the runtimes list. */
export const Delete: Story = {
   args: { runtimeId: 'rt-gpu' },
   beforeEach: ({ msw }) => {
      msw.use(
         http.delete('*/api/v1/runtimes/rt-gpu', () => new HttpResponse(null, { status: 204 }))
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Delete runtime' }));
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('alertdialog', { name: 'Delete Research sandbox?' });
      const confirm = within(dialog).getByRole('button', { name: 'Delete runtime' });
      await expect(confirm).toBeDisabled();
      await userEvent.click(within(dialog).getByRole('checkbox'));
      await userEvent.click(confirm);
      await waitFor(() =>
         expect(getRouter().push).toHaveBeenCalledWith('/elian/settings/runtimes')
      );
   },
};

export const NotFound: Story = {
   args: { runtimeId: 'rt-missing' },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/runtimes/rt-missing', () =>
            HttpResponse.json(
               { error: { code: 'NOT_FOUND', message: 'Runtime not found.' } },
               { status: 404 }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Runtime not found.')).toBeVisible();
   },
};
