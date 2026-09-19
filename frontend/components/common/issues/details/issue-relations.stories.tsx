import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import type { Goal } from '@/lib/goals';
import { useGoalsStore } from '@/store/goals-store';
import { useIssuesStore } from '@/store/issues-store';
import { IssueDependenciesSection, IssueGoalSection } from './issue-relations';
import {
   approvalsInbox,
   dependencyRef,
   issueApiHandlers,
   persistHealth,
   rotateKey,
   seedIssuesWorkspace,
   sharedFilter,
} from '../stories-fixtures';

const goal = (id: string, title: string, status: Goal['status']): Goal => ({
   id,
   workspaceId: 'ws-1',
   projectId: null,
   title,
   description: null,
   status,
   createdBy: null,
   createdAt: '2026-08-01T09:00:00Z',
   updatedAt: '2026-09-15T09:00:00Z',
   startedAt: null,
   completedAt: null,
   progress: null,
});

const goals = [
   goal('goal-1', 'Projects report their own health', 'active'),
   goal('goal-2', 'One inbox for every decision', 'planned'),
];

const meta = {
   component: IssueGoalSection,
   tags: ['ai-generated', 'needs-work'],
   args: { issue: persistHealth },
   decorators: [
      (Story) => (
         <div className="flex w-[260px] flex-col gap-6">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace();
      useGoalsStore.setState({ goals, loaded: true, error: null });
      msw.use(...issueApiHandlers);
   },
} satisfies Meta<typeof IssueGoalSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ServesAGoal: Story = {
   play: async ({ canvas }) => {
      await expect(
         canvas.getByRole('link', { name: /Projects report their own health/ })
      ).toHaveAttribute('href', expect.stringMatching(/\/goal\/goal-1\/overview$/));
   },
};

export const ServesNoGoal: Story = {
   args: { issue: sharedFilter },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await expect(canvas.getByText('Serves no goal.')).toBeInTheDocument();
      await userEvent.click(canvas.getByRole('button', { name: 'Link a goal' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(
         await body.findByRole('option', { name: /One inbox for every decision/ })
      );
      await waitFor(() =>
         expect(useIssuesStore.getState().getIssueById(sharedFilter.id)?.goal?.id).toBe('goal-2')
      );
   },
};

/* ------------------------------ Dependencies ----------------------------- */

const dependencies = (dependsOn: unknown[], blocks: unknown[]) =>
   http.get('*/api/v1/issues/:ref/dependencies', () => HttpResponse.json({ dependsOn, blocks }));

export const BlockedByAndBlocking: Story = {
   render: (args) => <IssueDependenciesSection issue={args.issue} />,
   beforeEach: ({ msw }) => {
      msw.use(
         dependencies(
            [dependencyRef(approvalsInbox, 'inReview')],
            [dependencyRef(rotateKey, 'blocked')]
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Blocks')).toBeInTheDocument();
      await expect(canvas.getByRole('link', { name: /BERR-46/ })).toBeInTheDocument();
      await expect(canvas.getByRole('link', { name: /BERR-43/ })).toBeInTheDocument();
   },
};

export const WaitsOnNothing: Story = {
   args: { issue: sharedFilter },
   render: (args) => <IssueDependenciesSection issue={args.issue} />,
   beforeEach: ({ msw }) => {
      msw.use(dependencies([], []));
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Waits on nothing.')).toBeInTheDocument();
      await expect(canvas.queryByText('Blocks')).toBeNull();
   },
};

export const AddingACycleIsRefused: Story = {
   args: { issue: sharedFilter },
   render: (args) => <IssueDependenciesSection issue={args.issue} />,
   beforeEach: ({ msw }) => {
      msw.use(
         dependencies([], []),
         http.post('*/api/v1/issues/:ref/dependencies', () =>
            HttpResponse.json(
               {
                  error: {
                     code: 'DEPENDENCY_CYCLE',
                     message: 'That would make a loop.',
                     details: null,
                  },
               },
               { status: 409 }
            )
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await canvas.findByText('Waits on nothing.');
      await userEvent.click(canvas.getByRole('button', { name: 'Add a task this one waits on' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /BERR-46/ }));
      // Refused by the server, said in plain words; the list stays as it was.
      await expect(await body.findByText(/That would make a loop/)).toBeVisible();
      await expect(canvas.getByText('Waits on nothing.')).toBeInTheDocument();
   },
};
