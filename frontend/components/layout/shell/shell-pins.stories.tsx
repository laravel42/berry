import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor } from 'storybook/test';
import type { Pin } from '@/lib/pins';
import { useIssuesStore } from '@/store/issues-store';
import { usePinsStore } from '@/store/pins-store';
import { issues, pins, seedSession, shellHandlers } from '../stories-fixtures';
import { ShellPins } from './shell-pins';

/** More pins than the rail shows before "Show more". */
const manyPins: Pin[] = [
   ...pins,
   {
      id: 'pin-4',
      targetType: 'issue',
      targetId: 'issue-38',
      position: 3,
      title: 'Move approvals and proposals into the inbox',
      identifier: 'BERR-38',
   },
   {
      id: 'pin-5',
      targetType: 'issue',
      targetId: 'issue-51',
      position: 4,
      title: 'Share the list filter across pages',
      identifier: 'BERR-51',
   },
   {
      id: 'pin-6',
      targetType: 'issue',
      targetId: 'issue-17',
      position: 5,
      title: 'Render run transcript steps in a code editor',
      identifier: 'BERR-17',
   },
];

const meta = {
   component: ShellPins,
   tags: ['ai-generated', 'needs-work'],
   args: { orgId: 'elian' },
   decorators: [
      (Story) => (
         <div className="w-[218px] bg-[var(--shell-rail)] py-2 font-mono font-light text-[var(--shell-text)]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedSession();
      useIssuesStore.getState().hydrateIssues(issues);
      usePinsStore.setState({ pins: [], loaded: false });
      msw.use(...shellHandlers);
   },
} satisfies Meta<typeof ShellPins>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pinned: Story = {
   play: async ({ canvas, userEvent }) => {
      // Loaded from GET /api/v1/pins on mount.
      await expect(await canvas.findByText('Persist project health')).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'Unpin Berry Server' }));
      await waitFor(() => expect(canvas.queryByText('Berry Server')).toBeNull());
   },
};

export const ShowMore: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/pins', () => HttpResponse.json({ nodes: manyPins })));
   },
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Show more' }));
      await expect(canvas.getByText('Render run transcript steps in a code editor')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Show less' })).toBeVisible();
   },
};

/** Nothing pinned: the section is not drawn at all. */
export const NothingPinned: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/pins', () => HttpResponse.json({ nodes: [] })));
   },
   play: async ({ canvas }) => {
      await expect(canvas.queryByText('Pinned')).toBeNull();
   },
};
