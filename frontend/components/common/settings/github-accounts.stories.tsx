import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import { GitHubAccountsList } from './github-accounts';
import { SettingsCard } from './shared';
import { apiError, githubAccounts, WS_ID } from './stories-fixtures';

const meta = {
   component: GitHubAccountsList,
   tags: ['ai-generated', 'needs-work'],
   args: { workspaceId: WS_ID, canManage: true },
   decorators: [
      (Story) => (
         <div className="max-w-2xl">
            <SettingsCard>
               <Story />
            </SettingsCard>
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/github/:ws/accounts', () =>
            HttpResponse.json({ accounts: githubAccounts, installPending: false })
         ),
         http.delete(
            '*/api/v1/github/:ws/accounts/:id',
            () => new HttpResponse(null, { status: 204 })
         )
      );
   },
} satisfies Meta<typeof GitHubAccountsList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoAccounts: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await expect(await canvas.findByText('elian-labs (organisation)')).toBeVisible();
      await expect(
         canvas.getByText(/14 repositories granted · 3 in this workspace · added by Andrea Lunelio/)
      ).toBeVisible();
      // Disconnecting first says how many of this workspace's repositories go with it.
      const [first] = canvas.getAllByRole('button', { name: 'Disconnect' });
      await userEvent.click(first!);
      const body = within(canvasElement.ownerDocument.body);
      await expect(
         await body.findByText(/3 repositories in this workspace are under elian-labs/)
      ).toBeVisible();
   },
};

export const PendingApproval: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/github/:ws/accounts', () =>
            HttpResponse.json({ accounts: [], installPending: true })
         )
      );
   },
};

export const OptionalWhenSignedIn: Story = {
   args: { optional: true },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/github/:ws/accounts', () =>
            HttpResponse.json({ accounts: [], installPending: false })
         )
      );
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/github/:ws/accounts', () =>
            apiError(502, 'GitHub timed out', 'PROVIDER_ERROR')
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('alert')).toHaveTextContent(
         'GitHub did not answer. Try again in a moment.'
      );
   },
};
