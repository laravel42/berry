import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor } from 'storybook/test';
import { GitLabIntegrationSettings } from './gitlab-integration-settings';
import { apiError, memberWorkspace, seedSession } from './stories-fixtures';

/** `GET /api/v1/gitlab/:ws/settings`, as `gitlabSettingsSchema` parses it. */
const gitlabSettingsState = {
   settings: {
      enabled: true,
      showLinkedMergeRequests: true,
      coAuthorTrailer: false,
      autoLinkMergeRequests: true,
      updatedAt: '2026-09-10T10:00:00Z',
   },
   canManage: true,
};

const meta = {
   component: GitLabIntegrationSettings,
   tags: ['ai-generated', 'needs-work'],
   args: {},
   decorators: [
      (Story) => (
         <div className="max-w-2xl">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(
         http.get('*/api/v1/gitlab/:ws/settings', () => HttpResponse.json(gitlabSettingsState)),
         http.patch('*/api/v1/gitlab/:ws/settings', async ({ request }) => {
            const patch = (await request.json()) as Record<string, boolean>;
            return HttpResponse.json({ settings: { ...gitlabSettingsState.settings, ...patch } });
         })
      );
   },
} satisfies Meta<typeof GitLabIntegrationSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Enabled: a feature toggle flips and stays flipped once the save lands. */
export const Enabled: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(await canvas.findByText('GitLab')).toBeVisible();
      const trailer = canvas.getByRole('switch', { name: 'Credit the requester on agent commits' });
      await expect(trailer).toHaveAttribute('aria-checked', 'false');
      await userEvent.click(trailer);
      await waitFor(() => expect(trailer).toHaveAttribute('aria-checked', 'true'));
   },
};

/** The master switch off: every feature toggle is muted and disabled. */
export const MasterSwitchOff: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/gitlab/:ws/settings', () =>
            HttpResponse.json({
               ...gitlabSettingsState,
               settings: { ...gitlabSettingsState.settings, enabled: false },
            })
         )
      );
   },
   play: async ({ canvas }) => {
      const master = await canvas.findByRole('switch', { name: 'Use GitLab in this workspace' });
      await expect(master).toHaveAttribute('aria-checked', 'false');
      for (const toggle of canvas.getAllByRole('switch').slice(1)) {
         await expect(toggle).toBeDisabled();
      }
   },
};

/** A member sees the same switches, all disabled, and why. */
export const MemberReadOnly: Story = {
   beforeEach: ({ msw }) => {
      seedSession(memberWorkspace);
      msw.use(
         http.get('*/api/v1/gitlab/:ws/settings', () =>
            HttpResponse.json({ ...gitlabSettingsState, canManage: false })
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('Only workspace admins can change these settings.')
      ).toBeVisible();
      for (const toggle of canvas.getAllByRole('switch')) await expect(toggle).toBeDisabled();
   },
};

/** A failed save rolls the optimistic flip back. */
export const ToggleFails: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.patch('*/api/v1/gitlab/:ws/settings', () =>
            apiError(500, 'GitLab settings could not be saved.')
         )
      );
   },
   play: async ({ canvas, userEvent }) => {
      const trailer = await canvas.findByRole('switch', {
         name: 'Credit the requester on agent commits',
      });
      await userEvent.click(trailer);
      await waitFor(() => expect(trailer).toHaveAttribute('aria-checked', 'false'));
   },
};

/** The settings could not be loaded at all: the page says so instead of rendering switches. */
export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/gitlab/:ws/settings', () =>
            apiError(503, 'GitLab settings could not be loaded.', 'INTEGRATIONS_NOT_CONFIGURED')
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('alert')).toHaveTextContent(
         'GitLab settings could not be loaded.'
      );
   },
};
