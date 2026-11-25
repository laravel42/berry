import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import type { UserEventObject } from 'storybook/test';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu';
import type { AgentAccess, AgentRoster } from '@/lib/agents';
import { useAgentsStore } from '@/store/agents-store';
import { useSessionStore } from '@/store/session-store';
import { frontendAgent, sessionUser } from './stories-fixtures';
import { AgentRowFields } from './agent-row-fields';

const roster: AgentRoster = {
   agentId: frontendAgent.id,
   ownerId: null,
   ownerName: null,
   runtimeId: 'rt-gpu',
   runtimeName: 'eu-west builder',
   runtimeStatus: 'unreachable',
   running: 1,
   queued: 0,
   totalRuns: 87,
   lastActiveAt: '2026-09-18T11:40:00Z',
   activity: [],
};

const access: AgentAccess = { assign: 'everyone', mention: 'everyone', members: [] };

const meta = {
   component: AgentRowFields,
   tags: ['ai-generated', 'needs-work'],
   args: { agent: frontendAgent, roster },
   render: (args) => (
      <ContextMenu>
         <ContextMenuTrigger className="flex h-10 w-[320px] items-center border px-3">
            <span>{args.agent.name}</span>
         </ContextMenuTrigger>
         <ContextMenuContent className="w-56">
            <AgentRowFields {...args} />
         </ContextMenuContent>
      </ContextMenu>
   ),
   beforeEach: ({ msw }) => {
      useSessionStore.setState({
         status: 'ready',
         user: sessionUser,
         workspace: { id: 'ws-1', name: 'Berry', slug: 'berry', role: 'admin' },
         workspaces: [],
      });
      useAgentsStore.getState().hydrateAgents([frontendAgent]);
      msw.use(
         http.get('*/api/v1/runtimes', () =>
            HttpResponse.json({
               nodes: [
                  {
                     id: 'rt-gpu',
                     name: 'eu-west builder',
                     kind: 'custom',
                     driver: 'agentcore',
                     arn: null,
                     endpointUrl: null,
                     qualifier: 'DEFAULT',
                     region: 'eu-west-1',
                     status: 'unreachable',
                     lastHealthAt: null,
                     lastHealthError: 'connect ETIMEDOUT',
                     concurrencyLimit: null,
                     visibility: 'workspace',
                     ownerId: null,
                     idleTimeoutS: 900,
                     maxLifetimeS: 28_800,
                     isDefault: false,
                     activeRuns: 1,
                  },
               ],
            })
         ),
         http.get('*/api/v1/agents/:id/access', () => HttpResponse.json(access)),
         http.put('*/api/v1/agents/:id/config', async ({ request }) =>
            HttpResponse.json({ ...frontendAgent, ...((await request.json()) as object) })
         ),
         http.put('*/api/v1/agents/:id/permissions', async ({ request }) => {
            const body = (await request.json()) as { access: AgentAccess };
            return HttpResponse.json({ ...frontendAgent, access: body.access });
         })
      );
   },
} satisfies Meta<typeof AgentRowFields>;

export default meta;
type Story = StoryObj<typeof meta>;

async function rightClick(target: HTMLElement, userEvent: UserEventObject) {
   await userEvent.pointer({ keys: '[MouseRight]', target });
}

/** Opens to the tier, runtime, concurrency and access fields, in that order. */
export const MenuFields: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await rightClick(canvas.getByText('Frontend Engineer'), userEvent);
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Tier')).toBeVisible();
      await expect(body.getByText('Runtime')).toBeVisible();
      await expect(body.getByText('Concurrency')).toBeVisible();
      await expect(body.getByText('Access')).toBeVisible();
   },
};

/** An unreachable runtime is named with its status, so it is not picked blind. */
export const UnreachableRuntimeIsLabelled: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await rightClick(canvas.getByText('Frontend Engineer'), userEvent);
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.hover(await body.findByText('Runtime'));
      await expect(await body.findByText('eu-west builder · Unreachable')).toBeVisible();
   },
};

/** Picking a tier writes it straight away, through the agent config route. */
export const ChoosingATierSavesIt: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await rightClick(canvas.getByText('Frontend Engineer'), userEvent);
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.hover(await body.findByText('Tier'));
      await userEvent.click(await body.findByText('BerryHigh'));
      await waitFor(() =>
         expect(useAgentsStore.getState().getAgentById(frontendAgent.id)?.tier).toBe('berry_high')
      );
   },
};

/** Archived agents keep the menu visible but every field disabled. */
export const ArchivedDisablesEveryField: Story = {
   args: { agent: { ...frontendAgent, archivedAt: '2026-08-02T10:00:00Z' } },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await rightClick(canvas.getByText('Frontend Engineer'), userEvent);
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Tier')).toHaveAttribute('aria-disabled', 'true');
   },
};
