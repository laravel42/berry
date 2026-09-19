import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import {
   issues,
   liveAgents,
   rosterMap,
   runs,
   seedSession,
   storyHandlers,
} from '@/components/common/agents/stories-fixtures';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';
import { useRunsStore } from '@/store/runs-store';
import RunOverview from './run-overview';

const navigation = (query: Record<string, string> = {}) => ({
   nextjs: {
      navigation: { pathname: '/berry/runs', segments: [['orgId', 'berry']], query },
   },
});

const meta = {
   component: RunOverview,
   tags: ['ai-generated', 'needs-work'],
   parameters: navigation(),
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
      seedSession();
      useAgentsStore.setState({
         agents: liveAgents,
         archived: null,
         roster: rosterMap,
         error: null,
      });
      useIssuesStore.getState().hydrateIssues(issues);
      // Empty, so the page loads the board's runs itself.
      useRunsStore.setState({ runs: [], error: null });
   },
   decorators: [
      (Story) => (
         <div className="flex h-[640px] w-[1100px] flex-col border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof RunOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {
   play: async ({ canvas }) => {
      // GET /api/v1/boards/:id/runs (MSW) fills the table.
      await expect(await canvas.findByText('Add an empty state to the goals list')).toBeVisible();
      await expect(canvas.getAllByRole('row')).toHaveLength(1 + runs.length);
   },
};

/** `?run=` opens a finished run: its summary, and what it delivered. */
export const SelectedRun: Story = {
   parameters: navigation({ run: 'run-9c1d5e77' }),
   play: async ({ canvas, canvasElement, userEvent }) => {
      // The delivery strip reads the run.delivered frame from the stream.
      await expect(await canvas.findByText('berr-40-inbox-approvals')).toBeVisible();
      await expect(canvas.getByRole('link', { name: /#118/ })).toHaveAttribute(
         'href',
         'https://github.com/berry-dev/berry/pull/118'
      );
      await userEvent.click(canvas.getByRole('button', { name: 'Open transcript' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('dialog', { name: 'Run transcript' })).toBeVisible();
   },
};

/** A run still in progress can be cancelled from the header. */
export const RunningRun: Story = {
   parameters: navigation({ run: 'run-7f3a91c2' }),
   beforeEach: ({ msw }) => {
      msw.use(
         http.get(
            '*/api/v1/runs/:id/events',
            () => new HttpResponse('', { headers: { 'content-type': 'text/event-stream' } })
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Cancel run' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Run cancelled')).toBeVisible();
   },
};

export const Empty: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/boards/:id/runs', () =>
            HttpResponse.json({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } })
         )
      );
   },
};
