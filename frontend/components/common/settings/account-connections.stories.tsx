import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import AccountConnections from './account-connections';
import { apiError, channelIdentities } from './stories-fixtures';

const meta = {
   component: AccountConnections,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: ({ msw }) => {
      let nodes = [...channelIdentities];
      msw.use(
         http.get('*/api/v1/me/channels', () => HttpResponse.json({ nodes })),
         http.post('*/api/v1/me/channels', async ({ request }) => {
            const input = (await request.json()) as {
               channel: string;
               address: string;
               preferred?: boolean;
            };
            const created = {
               id: `chan-${nodes.length + 1}`,
               channel: input.channel,
               address: input.address,
               displayName: null,
               verified: false,
               preferred: input.preferred ?? false,
               createdAt: '2026-09-18T12:00:00Z',
            };
            nodes = [...nodes, created];
            return HttpResponse.json(created);
         }),
         http.delete('*/api/v1/me/channels/:id', ({ params }) => {
            nodes = nodes.filter((entry) => entry.id !== params.id);
            return new HttpResponse(null, { status: 204 });
         })
      );
   },
} satisfies Meta<typeof AccountConnections>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Addresses: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('andrea@elian.dev')).toBeVisible();
      // Unverified addresses say so rather than looking confirmed.
      await expect(canvas.getByText('Email · preferred · not verified')).toBeVisible();
      await expect(canvas.getByText('Telegram · preferred · verified')).toBeVisible();
   },
};

export const AddAnAddress: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/me/channels', () => HttpResponse.json({ nodes: [] })));
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await expect(await canvas.findByText('No addresses yet')).toBeVisible();
      await userEvent.type(canvas.getByPlaceholderText('you@example.com'), 'ops@elian.dev');
      await userEvent.click(canvas.getByRole('button', { name: 'Add' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Email address added.')).toBeVisible();
   },
};

export const RemoveConfirm: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await canvas.findByText('@alunelio');
      const [, second] = canvas.getAllByRole('button', { name: 'Remove' });
      await userEvent.click(second!);
      // The confirmation is an alert dialog in a portal.
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('alertdialog')).toBeVisible();
      await expect(body.getByText(/Berry stops reaching you at @alunelio/)).toBeVisible();
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/me/channels', () => apiError(500, 'Channels could not be read.')));
   },
};
