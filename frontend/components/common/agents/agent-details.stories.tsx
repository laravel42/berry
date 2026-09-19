import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';
import AgentDetails from './agent-details';
import {
   archivedAgent,
   frontendAgent,
   issues,
   releaseAgent,
   seedSession,
   storyHandlers,
} from './stories-fixtures';

const navigation = (query: Record<string, string> = {}) => ({
   nextjs: {
      navigation: {
         pathname: '/berry/agents/agent-frontend',
         segments: [['orgId', 'berry']],
         query,
      },
   },
});

const meta = {
   component: AgentDetails,
   tags: ['ai-generated', 'needs-work'],
   parameters: navigation(),
   args: { agentId: frontendAgent.id },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
      seedSession();
      // Not seeded: the page loads the agent itself, so the store starts empty.
      useAgentsStore.setState({ agents: [], archived: null, roster: new Map(), error: null });
      useIssuesStore.getState().hydrateIssues(issues);
   },
   decorators: [
      (Story) => (
         <div className="flex h-[900px] w-[1200px] flex-col">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentDetails>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
   play: async ({ canvas }) => {
      // GET /api/v1/agents/:id, the 30-day roster and the task page all come from MSW.
      await expect(
         await canvas.findByRole('heading', { level: 1, name: 'Frontend Engineer' })
      ).toBeVisible();
      await expect(canvas.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
         'aria-selected',
         'true'
      );
   },
};

export const RoleTab: Story = { parameters: navigation({ view: 'role' }) };

export const CapabilitiesTab: Story = { parameters: navigation({ view: 'capabilities' }) };

export const SettingsTab: Story = { parameters: navigation({ view: 'settings' }) };

/** A plain agent that has run a handful of times. */
export const PlainAgent: Story = { args: { agentId: releaseAgent.id } };

export const Archived: Story = {
   args: { agentId: archivedAgent.id },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('This agent is archived and takes no work.')
      ).toBeVisible();
   },
};

export const Forbidden: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/agents/:id', () =>
            HttpResponse.json(
               { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
               { status: 403 }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('You do not have access to this agent.')).toBeVisible();
   },
};
