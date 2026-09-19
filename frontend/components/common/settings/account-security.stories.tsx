import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import AccountSecurity from './account-security';
import { accountSessions, apiError } from './stories-fixtures';

const meta = {
   component: AccountSecurity,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/me/sessions', () => HttpResponse.json({ nodes: accountSessions })),
         http.delete('*/api/v1/me/sessions/:id', () => new HttpResponse(null, { status: 204 }))
      );
   },
} satisfies Meta<typeof AccountSecurity>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sessions: Story = {
   play: async ({ canvas, userEvent }) => {
      // Devices are named from their user agent, not shown raw.
      await expect(await canvas.findByText('Chrome on macOS')).toBeVisible();
      await expect(canvas.getByText('Firefox on Linux')).toBeVisible();
      // KNOWN BUG (lib/settings.ts describeDevice): an iPhone user agent says
      // "like Mac OS X", which is tested before iPhone/iPad, so it reads as
      // macOS. Left failing so the bug stays visible.
      await expect(canvas.getByText('Safari on iOS')).toBeVisible();
      // Signing a device out removes it optimistically once DELETE succeeds.
      const [first] = canvas.getAllByRole('button', { name: 'Sign out' });
      await userEvent.click(first!);
      await expect(canvas.queryByText('Chrome on macOS')).toBeNull();
   },
};

export const NoOtherSessions: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/me/sessions', () => HttpResponse.json({ nodes: [] })));
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/me/sessions', () =>
            apiError(503, 'Sessions are unavailable right now.')
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Sessions are unavailable right now.')).toBeVisible();
   },
};
