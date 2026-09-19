import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import { useIssuesStore } from '@/store/issues-store';
import { useMembersStore } from '@/store/members-store';
import { useProjectsStore } from '@/store/projects-store';
import { useRecentIssuesStore } from '@/store/recent-issues-store';
import { CommandPalette } from './command-palette';
import {
   emptyConnection,
   issues,
   me,
   seedSession,
   serverProject,
   teammate,
   webProject,
   workspaceRoute,
} from './stories-fixtures';

/** What `GET /api/v1/search?query=health` finds across the workspace. */
const searchResults = [
   {
      type: 'issue',
      id: 'issue-42',
      title: 'Persist project health',
      subtitle: 'Berry Server',
      identifier: 'BERR-42',
      boardId: 'board-1',
      agentId: null,
      status: 'in_progress',
   },
   {
      type: 'issue',
      id: 'issue-29',
      title: 'Health chip lives only in the browser',
      subtitle: 'Berry Web',
      identifier: 'BERR-29',
      boardId: 'board-1',
      agentId: null,
      status: 'cancelled',
   },
   {
      type: 'agent',
      id: 'agent-1',
      title: 'Backend Engineer',
      subtitle: 'Records project health',
      identifier: null,
      boardId: null,
      agentId: 'agent-1',
      status: null,
   },
];

/** The palette only listens for ⌘K / Ctrl+K; every story opens it the same way. */
async function openPalette(
   userEvent: { keyboard: (text: string) => Promise<void> },
   doc: Document
) {
   await userEvent.keyboard('{Meta>}k{/Meta}');
   const body = within(doc.body);
   return body.findByRole('dialog', { name: 'Command menu' });
}

const meta = {
   component: CommandPalette,
   tags: ['ai-generated', 'needs-work'],
   parameters: { nextjs: { navigation: workspaceRoute('/elian/tasks') } },
   decorators: [
      (Story) => (
         <div className="text-muted-foreground">
            Press ⌘K to open the command menu.
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedSession();
      useIssuesStore.getState().hydrateIssues(issues);
      useMembersStore.setState({ members: [me, teammate] });
      useProjectsStore.setState({ projects: [serverProject, webProject] });
      useRecentIssuesStore.setState({ issues: [] });
      msw.use(
         http.get('*/api/v1/search', ({ request }) => {
            const query = new URL(request.url).searchParams.get('query') ?? '';
            return HttpResponse.json(
               query.toLowerCase().includes('health')
                  ? { nodes: searchResults, pageInfo: emptyConnection.pageInfo }
                  : emptyConnection
            );
         })
      );
   },
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const dialog = await openPalette(userEvent, canvasElement.ownerDocument);
      const palette = within(dialog);
      await expect(palette.getByRole('option', { name: /Inbox/ })).toBeVisible();
      // Six pages up front; the rest are one row away.
      await expect(palette.queryByRole('option', { name: /Runtimes/ })).toBeNull();
      await userEvent.click(palette.getByRole('option', { name: 'Show all pages' }));
      await expect(palette.getByRole('option', { name: /Runtimes/ })).toBeVisible();
   },
};

/** Server results, with cancelled tasks grouped apart, beside local people and projects. */
export const Searching: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const dialog = await openPalette(userEvent, canvasElement.ownerDocument);
      const palette = within(dialog);
      await userEvent.type(palette.getByRole('combobox'), 'health');
      await expect(await palette.findByText('Cancelled tasks')).toBeVisible();
      await expect(palette.getByRole('option', { name: /BERR-42/ })).toBeVisible();
   },
};

export const PeopleAndProjects: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const dialog = await openPalette(userEvent, canvasElement.ownerDocument);
      const palette = within(dialog);
      await userEvent.type(palette.getByRole('combobox'), 'berry');
      await expect(palette.getByRole('option', { name: /Berry Server/ })).toBeVisible();
      await expect(palette.getByRole('option', { name: /mara@berry\.dev/ })).toBeVisible();
   },
};

/** On a task page the palette carries the task as context, with its commands. */
export const OnATask: Story = {
   parameters: {
      nextjs: { navigation: workspaceRoute('/elian/issue/BERR-42', [['issueId', 'BERR-42']]) },
   },
   play: async ({ canvasElement, userEvent }) => {
      const dialog = await openPalette(userEvent, canvasElement.ownerDocument);
      const palette = within(dialog);
      await expect(palette.getByText('BERR-42 ⋅')).toBeVisible();
      await expect(palette.getByRole('option', { name: 'Copy link' })).toBeVisible();
      await userEvent.click(palette.getByRole('button', { name: 'Clear task context' }));
      await expect(palette.queryByRole('option', { name: 'Copy link' })).toBeNull();
   },
};

export const NoMatches: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const dialog = await openPalette(userEvent, canvasElement.ownerDocument);
      const palette = within(dialog);
      await userEvent.type(palette.getByRole('combobox'), 'qqzx');
      await expect(await palette.findByText('Nothing matches that.')).toBeVisible();
   },
};
