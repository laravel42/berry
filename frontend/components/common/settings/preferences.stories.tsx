import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import Preferences from './preferences';
import { apiError, profile, seedSession, userSettings } from './stories-fixtures';

const meta = {
   component: Preferences,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(
         http.get('*/api/v1/me', () => HttpResponse.json(profile)),
         http.patch('*/api/v1/me', async ({ request }) => {
            const patch = (await request.json()) as Record<string, unknown>;
            return HttpResponse.json({ ...profile, ...patch });
         }),
         http.get('*/api/v1/me/settings', () => HttpResponse.json(userSettings)),
         http.patch('*/api/v1/me/settings', async ({ request }) => {
            const patch = (await request.json()) as Record<string, unknown>;
            return HttpResponse.json({ ...userSettings, ...patch });
         })
      );
   },
} satisfies Meta<typeof Preferences>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByDisplayValue('Andrea Lunelio')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Time zone' })).toHaveTextContent(
         'Europe/Rome'
      );
   },
};

export const RenameAutosaves: Story = {
   play: async ({ canvas, userEvent }) => {
      const field = await canvas.findByDisplayValue('Andrea Lunelio');
      await userEvent.clear(field);
      await userEvent.type(field, 'Andrea L.');
      // Blur writes at once; the indicator says whether it landed.
      await userEvent.tab();
      await expect(await canvas.findByText('Saved')).toBeVisible();
   },
};

export const RenameFails: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.patch('*/api/v1/me', () =>
            apiError(422, 'Names are limited to 80 characters.', 'VALIDATION_FAILED')
         )
      );
   },
   play: async ({ canvas, userEvent }) => {
      const field = await canvas.findByDisplayValue('Andrea Lunelio');
      await userEvent.type(field, ' the Second');
      await userEvent.tab();
      await expect(await canvas.findByText('Names are limited to 80 characters.')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible();
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/me/settings', () => apiError(500, 'Settings could not be read.')));
   },
};
