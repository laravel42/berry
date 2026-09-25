import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import AiAgents from './ai-agents';
import { apiError, page, workspaceAgents } from './stories-fixtures';

const meta = {
   component: AiAgents,
   tags: ['ai-generated', 'needs-work'],
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/agents', () => HttpResponse.json(page(workspaceAgents))));
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

/** Each card opens that agent's settings page. */
export const OpensAgentSettings: Story = {
   play: async ({ canvas }) => {
      const card = await canvas.findByRole('link', { name: /Orchestrator/ });
      await expect(card).toHaveAttribute('href', '/berry/settings/ai/agent-orch');
      await expect(card).toHaveTextContent('no model set · 1 of 5 permissions');
   },
};

/** Under a model gateway a card names the agent's tier, its own or its role's. */
export const Gateway: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/config', () =>
            HttpResponse.json({ capabilities: { githubSignIn: true, modelGateway: true } })
         ),
         http.get('*/api/v1/agents', () =>
            HttpResponse.json(
               page(
                  workspaceAgents.map((agent) =>
                     agent.id === 'agent-eng'
                        ? { ...agent, tier: 'berry_max', defaultTier: 'berry_mid' }
                        : { ...agent, defaultTier: 'berry_low' }
                  )
               )
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('BerryMax · 4 of 5 permissions')).toBeVisible();
      await expect(canvas.getByText('BerryLow · 1 of 5 permissions')).toBeVisible();
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
