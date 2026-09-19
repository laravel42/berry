import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor } from 'storybook/test';
import { usePinsStore } from '@/store/pins-store';
import { IssuePinButton } from './issue-pin-button';
import { persistHealth, seedIssuesWorkspace } from '../stories-fixtures';

const pin = {
   id: 'pin-1',
   targetType: 'issue' as const,
   targetId: persistHealth.id,
   position: 0,
   title: persistHealth.title,
   identifier: persistHealth.identifier,
};

const meta = {
   component: IssuePinButton,
   tags: ['ai-generated', 'needs-work'],
   args: { issueId: persistHealth.id },
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace({ withSession: true });
      msw.use(
         http.post('*/api/v1/pins', () => HttpResponse.json(pin)),
         http.delete('*/api/v1/pins/:id', () => new HttpResponse(null, { status: 204 }))
      );
   },
} satisfies Meta<typeof IssuePinButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotPinned: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Pin' }));
      // The rail's store takes the server's pin, and the button flips.
      await expect(await canvas.findByRole('button', { name: 'Unpin' })).toBeInTheDocument();
      await expect(usePinsStore.getState().pins).toHaveLength(1);
   },
};

export const Pinned: Story = {
   beforeEach: () => {
      usePinsStore.setState({ pins: [pin], loaded: true });
   },
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Unpin' }));
      await waitFor(() => expect(usePinsStore.getState().pins).toHaveLength(0));
   },
};

export const PinFails: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/pins', () =>
            HttpResponse.json(
               { error: { code: 'PIN_LIMIT', message: 'Too many pins', details: null } },
               { status: 409 }
            )
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Pin' }));
      const body = canvasElement.ownerDocument.body;
      await waitFor(() => expect(body).toHaveTextContent('The pin could not be changed.'));
   },
};
