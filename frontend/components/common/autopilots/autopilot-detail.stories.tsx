import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import {
   autopilotDetail,
   coverageWithoutDefault,
   liveAgents,
   rosterMap,
   seedSession,
   storyHandlers,
} from '@/components/common/agents/stories-fixtures';
import { useAgentsStore } from '@/store/agents-store';
import AutopilotDetail from './autopilot-detail';

const navigation = (query: Record<string, string> = {}) => ({
   nextjs: {
      navigation: {
         pathname: '/berry/autopilot/ap-triage',
         segments: [['orgId', 'berry']],
         query,
      },
   },
});

const meta = {
   component: AutopilotDetail,
   tags: ['ai-generated', 'needs-work'],
   parameters: navigation(),
   args: { autopilotId: autopilotDetail.id },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
      seedSession();
      useAgentsStore.setState({
         agents: liveAgents,
         archived: null,
         roster: rosterMap,
         error: null,
      });
   },
   decorators: [
      (Story) => (
         <div className="flex h-[860px] w-[1200px] flex-col">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AutopilotDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      // The autopilot, its runs and deliveries all load from MSW.
      await expect(await canvas.findByRole('heading', { name: 'Morning triage' })).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'Run now' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Queued a run')).toBeVisible();
   },
};

export const TriggersTab: Story = { parameters: navigation({ view: 'triggers' }) };

export const RunsTab: Story = { parameters: navigation({ view: 'runs' }) };

export const DeliveriesTab: Story = { parameters: navigation({ view: 'deliveries' }) };

/** A guest can read it but not run, edit or delete it. */
export const GuestView: Story = {
   beforeEach: () => {
      seedSession('guest');
   },
};

/** The assignee has nowhere to run: the banner says so and run-now is off. */
export const NoRuntime: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/runtimes/agent-coverage', () =>
            HttpResponse.json({
               ...coverageWithoutDefault,
               nodes: coverageWithoutDefault.nodes.map((node) => ({
                  ...node,
                  runtimeId: null,
                  runtimeName: null,
               })),
            })
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('Orchestrator has no runtime, so this autopilot cannot fire.')
      ).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Run now' })).toBeDisabled();
   },
};

export const Paused: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/autopilots/:id', () =>
            HttpResponse.json({ ...autopilotDetail, status: 'paused' })
         )
      );
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/autopilots/:id', () =>
            HttpResponse.json(
               { error: { code: 'NOT_FOUND', message: 'Not found' } },
               { status: 404 }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('This autopilot does not exist, or is in another workspace.')
      ).toBeVisible();
   },
};
