import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor } from 'storybook/test';
import AiAgents from './ai-agents';
import { apiError, page, workspaceAgents } from './stories-fixtures';

const meta = {
   component: AiAgents,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/agents', () => HttpResponse.json(page(workspaceAgents))),
         http.put('*/api/v1/agents/:id/permissions', async ({ params, request }) => {
            const { permissions } = (await request.json()) as { permissions: string[] };
            const found = workspaceAgents.find((entry) => entry.id === params.id);
            return HttpResponse.json({ ...found, permissions });
         })
      );
   },
} satisfies Meta<typeof AiAgents>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Roster: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Backend Engineer')).toBeVisible();
      await expect(canvas.getByText('claude-opus-5 · 4 of 5 permissions')).toBeVisible();
      // The risky grant is called out in the summary line.
      await expect(canvas.getByText(/can merge without review/)).toBeVisible();
   },
};

export const GrantPermission: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(await canvas.findByText('Orchestrator'));
      const branches = canvas.getByRole('switch', { name: /Create branches/ });
      await expect(branches).toHaveAttribute('aria-checked', 'false');
      await userEvent.click(branches);
      await waitFor(() => expect(branches).toHaveAttribute('aria-checked', 'true'));
      await expect(canvas.getByText('no model set · 2 of 5 permissions')).toBeVisible();
   },
};

export const NoAgents: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/agents', () => HttpResponse.json(page([]))));
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/agents', () => apiError(500, 'Agents could not be listed.')));
   },
};
