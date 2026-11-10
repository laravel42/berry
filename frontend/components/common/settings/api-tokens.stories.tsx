import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import ApiTokens from './api-tokens';
import { apiError, page, personalTokens } from './stories-fixtures';

const meta = {
   component: ApiTokens,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/tokens', () => HttpResponse.json(page(personalTokens))),
         http.post('*/api/v1/tokens', async ({ request }) => {
            const input = (await request.json()) as { name: string; scopes?: string[] };
            return HttpResponse.json({
               personalToken: {
                  id: 'tok-new',
                  name: input.name,
                  prefix: 'bry_pat_N3w0',
                  lastUsedAt: null,
                  expiresAt: '2026-12-17T11:59:00Z',
                  revokedAt: null,
                  createdAt: '2026-09-18T12:00:00Z',
                  scopes: input.scopes ?? null,
               },
               token: 'bry_pat_N3w0_s3cr3t_8f1c2a9b7d4e6f0a1b2c3d4e5f6a7b8c',
            });
         }),
         http.delete('*/api/v1/tokens/:id', () => new HttpResponse(null, { status: 204 }))
      );
   },
} satisfies Meta<typeof ApiTokens>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Keys: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('CI release bot')).toBeVisible();
      // A past expiry reads as expired; a null scope list as full access.
      await expect(canvas.getByText(/bry_pat_c01d… · .* · expired ·/)).toBeVisible();
      await expect(canvas.getByText(/never expires · full access/)).toBeVisible();
   },
};

export const CreateShowsSecretOnce: Story = {
   play: async ({ canvas, userEvent }) => {
      await canvas.findByText('CI release bot');
      await userEvent.type(
         canvas.getByRole('textbox', { name: 'What is it for?' }),
         'Deploy script'
      );
      await userEvent.click(canvas.getByRole('button', { name: 'Create key' }));

      // The key is shown once, in a card above the list, with its own copy button.
      await expect(await canvas.findByText('Copy your new key now')).toBeVisible();
      await expect(canvas.getByText(/bry_pat_N3w0_s3cr3t/)).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Copy' })).toBeVisible();
   },
};

export const Empty: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/tokens', () => HttpResponse.json(page([]))));
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/tokens', () => apiError(500, 'Tokens could not be listed.')));
   },
};
