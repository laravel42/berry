import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import RepositoriesSettings from './repositories-settings';
import {
   apiError,
   githubSettingsState,
   grantedRepositories,
   integrationProviders,
   memberWorkspace,
   seedSession,
   workspaceRepositories,
} from './stories-fixtures';

const meta = {
   component: RepositoriesSettings,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      nextjs: { navigation: { pathname: '/elian/settings/repositories' } },
   },
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(
         http.get('*/api/v1/github/:ws/repositories', () =>
            HttpResponse.json({ repositories: workspaceRepositories })
         ),
         http.get('*/api/v1/github/:ws/settings', () => HttpResponse.json(githubSettingsState)),
         http.get('*/api/v1/github/:ws/granted-repositories', () =>
            HttpResponse.json(grantedRepositories)
         ),
         http.get('*/api/v1/integrations/github/app', () =>
            HttpResponse.json({
               app: null,
               installations: [],
               installPending: false,
               installUrl: 'https://github.com/apps/berry-elian/installations/new',
               installReason: null,
            })
         ),
         http.get('*/api/v1/integrations/providers', () =>
            HttpResponse.json({ providers: integrationProviders })
         ),
         http.patch('*/api/v1/github/:ws/repositories/:id', async ({ params, request }) => {
            const patch = (await request.json()) as Record<string, string>;
            const found = workspaceRepositories.find((entry) => entry.id === params.id);
            return HttpResponse.json({ repository: { ...found, ...patch } });
         })
      );
   },
} satisfies Meta<typeof RepositoriesSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Repositories: Story = {
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByDisplayValue('https://github.com/elian-labs/berry')
      ).toBeVisible();
      await expect(canvas.getByText('elian-labs/berry-runtime')).toBeVisible();
      await expect(
         canvas.getByText(/Installed on acme-corp for another Berry workspace/)
      ).toBeVisible();
   },
};

export const EditAutosaves: Story = {
   play: async ({ canvas, userEvent }) => {
      const [description] = await canvas.findAllByRole('textbox', { name: 'Description' });
      await userEvent.type(description!, ' Monorepo.');
      await userEvent.tab();
      await expect(await canvas.findByText('Saved')).toBeVisible();
   },
};

export const InvalidUrl: Story = {
   play: async ({ canvas, userEvent }) => {
      await canvas.findByDisplayValue('https://github.com/elian-labs/berry');
      await userEvent.click(canvas.getByRole('button', { name: 'Add repository' }));
      const urls = canvas.getAllByRole('textbox', { name: 'Repository URL' });
      await userEvent.type(urls[urls.length - 1]!, 'not a url');
      await userEvent.tab();
      await expect(await canvas.findByRole('alert')).toHaveTextContent(
         'Use an https:// or ssh address.'
      );
   },
};

export const NoAccessYet: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/github/:ws/repositories', () =>
            HttpResponse.json({ repositories: [] })
         ),
         http.get('*/api/v1/github/:ws/granted-repositories', () =>
            HttpResponse.json({ repositories: [], accounts: [], refreshedAt: null })
         ),
         http.get('*/api/v1/integrations/providers', () => HttpResponse.json({ providers: [] }))
      );
   },
};

export const MemberReadOnly: Story = {
   beforeEach: ({ msw }) => {
      seedSession(memberWorkspace);
      msw.use(
         http.get('*/api/v1/github/:ws/settings', () =>
            HttpResponse.json({ ...githubSettingsState, canManage: false })
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('Only workspace admins can change this list.')
      ).toBeVisible();
      await expect(canvas.queryByRole('button', { name: 'Add repository' })).toBeNull();
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/github/:ws/repositories', () =>
            apiError(502, 'GitHub is down', 'PROVIDER_ERROR')
         )
      );
   },
};
