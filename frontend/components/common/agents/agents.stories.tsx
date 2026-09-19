import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import { useAgentsListStore } from '@/store/agents-list-store';
import { useAgentsStore } from '@/store/agents-store';
import Agents from './agents';
import { orgParams, storyHandlers } from './stories-fixtures';

const meta = {
   component: Agents,
   tags: ['ai-generated', 'needs-work'],
   parameters: orgParams,
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
      useAgentsStore.setState({ agents: [], archived: null, roster: new Map(), error: null });
      useAgentsListStore.setState({
         scope: 'all',
         sortKey: 'activity',
         sortDescending: true,
         filters: [],
         selected: [],
         columns: ['activity', 'lastActive', 'model'],
      });
   },
   decorators: [
      (Story) => (
         <div className="flex h-[640px] w-[1400px] flex-col border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof Agents>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Roster: Story = {
   play: async ({ canvas }) => {
      // The list and its roster are read from MSW, newest activity first.
      await expect(await canvas.findByText('Orchestrator')).toBeVisible();
      await expect(canvas.getByText('legacy-importer')).toBeVisible();
   },
};

export const BulkSelection: Story = {
   play: async ({ canvas, userEvent }) => {
      await canvas.findByText('Orchestrator');
      await userEvent.click(canvas.getByRole('checkbox', { name: 'Select every agent' }));
      await expect(canvas.getByText('4 selected')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Set access' })).toBeVisible();
   },
};

export const CancelRuns: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await canvas.findByText('Frontend Engineer');
      await userEvent.click(canvas.getByRole('button', { name: 'Actions for Frontend Engineer' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Cancel all runs' }));
      // One running and two queued, from the roster.
      await expect(
         await body.findByRole('alertdialog', { name: 'Cancel every run of Frontend Engineer?' })
      ).toBeVisible();
   },
};

export const ArchiveScope: Story = {
   beforeEach: () => {
      useAgentsListStore.setState({ scope: 'archived' });
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('standup-bot')).toBeVisible();
   },
};

/** Sorted by name, with the access column switched on. */
export const ByName: Story = {
   beforeEach: () => {
      useAgentsListStore.setState({
         sortKey: 'name',
         sortDescending: false,
         columns: ['activity', 'model', 'access'],
      });
   },
};

export const EmptyWorkspace: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/agents', () =>
            HttpResponse.json({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } })
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('heading', { name: 'No agents yet.' })).toBeVisible();
      await expect(canvas.queryByRole('link', { name: 'Create an agent' })).toBeNull();
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/agents', () =>
            HttpResponse.json(
               { error: { code: 'INTERNAL', message: 'The database is unreachable.' } },
               { status: 500 }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('The database is unreachable.')).toBeVisible();
   },
};
