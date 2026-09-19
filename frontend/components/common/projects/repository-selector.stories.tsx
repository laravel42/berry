import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { useProjectsStore } from '@/store/projects-store';
import { RepositorySelector } from './repository-selector';
import {
   apiRepositories,
   projectHealth,
   projectInbox,
   seedProjectStores,
} from './stories-fixtures';

const meta = {
   component: RepositorySelector,
   tags: ['ai-generated', 'needs-work'],
   args: { project: projectHealth },
   beforeEach: ({ msw }) => {
      seedProjectStores();
      msw.use(
         http.get('*/api/v1/integrations/github/repositories', () =>
            HttpResponse.json(apiRepositories)
         ),
         http.patch('*/api/v1/projects/:id', () => HttpResponse.json({}))
      );
   },
   decorators: [
      (Story) => (
         <div className="w-[260px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof RepositorySelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Linked: Story = {};

export const Unlinked: Story = { args: { project: projectInbox } };

/** The list loads when the picker opens; picking one saves straight away. */
export const LinkRepository: Story = {
   args: { project: projectInbox },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: /Link a repository/ }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /berry-dev\/plugin-sdk/ }));
      await expect(await body.findByText('Linked to berry-dev/plugin-sdk')).toBeVisible();
      await waitFor(() =>
         expect(useProjectsStore.getState().getProjectById(projectInbox.id)?.githubRepo).toBe(
            'berry-dev/plugin-sdk'
         )
      );
   },
};

/** Without the GitHub App only public repositories show, and the footer says so. */
export const PublicOnly: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/integrations/github/repositories', () =>
            HttpResponse.json({
               repositories: apiRepositories.repositories.filter((repo) => !repo.private),
               access: {
                  selectedOnly: false,
                  installed: false,
                  installUrl: 'https://github.com/apps/berry/installations/new',
                  source: 'connection',
               },
            })
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button'));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText(/Only public repositories are visible/)).toBeVisible();
      await expect(body.getByRole('link', { name: 'Install the app' })).toBeVisible();
   },
};

/** A failed load is shown as a failure, not as an empty list. */
export const LoadFails: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/integrations/github/repositories', () =>
            HttpResponse.json(
               {
                  error: { code: 'INTEGRATION_NOT_CONNECTED', message: 'GitHub is not connected.' },
               },
               { status: 409 }
            )
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button'));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('GitHub is not connected.')).toBeVisible();
   },
};
