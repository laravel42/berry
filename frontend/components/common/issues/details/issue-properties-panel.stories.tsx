import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { getIssueDetail } from '@/data/issue-details';
import { IssuePropertiesPanel } from './issue-properties-panel';
import {
   healthTests,
   issueApiHandlers,
   issueDetailHandlers,
   persistHealth,
   seedIssuesWorkspace,
   sharedFilter,
} from '../stories-fixtures';

const meta = {
   component: IssuePropertiesPanel,
   tags: ['ai-generated', 'needs-work'],
   args: { issue: persistHealth, detail: getIssueDetail(persistHealth) },
   decorators: [
      (Story) => (
         <aside className="flex h-[900px] w-[292px] flex-col overflow-hidden border-l bg-muted/15 px-5 pt-3 pb-3.5">
            <Story />
         </aside>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace({ withSession: true });
      msw.use(...issueDetailHandlers, ...issueApiHandlers);
   },
} satisfies Meta<typeof IssuePropertiesPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AgentOnATask: Story = {
   play: async ({ canvas }) => {
      await expect(
         canvas.getByRole('button', { name: 'Assigned to Backend Engineer' })
      ).toBeInTheDocument();
      await expect(canvas.getByRole('button', { name: 'Project' })).toHaveTextContent(
         'Project health'
      );
      // The label read comes back from the server, not from the list row.
      await expect(await canvas.findByRole('button', { name: 'Backend' })).toBeInTheDocument();
      await expect(await canvas.findByText('Blocks')).toBeInTheDocument();
   },
};

export const UnassignedNoDueDate: Story = {
   args: {
      issue: { ...sharedFilter, assignee: null, dueDate: undefined },
      detail: getIssueDetail(sharedFilter),
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Assign')).toBeInTheDocument();
      await expect(canvas.getByRole('button', { name: 'Set date' })).toBeInTheDocument();
   },
};

export const SubTaskWithParent: Story = {
   args: { issue: healthTests, detail: getIssueDetail(healthTests) },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Parent task')).toBeInTheDocument();
   },
};

export const WithRelatedAndDiffs: Story = {
   args: {
      detail: {
         ...getIssueDetail(persistHealth),
         milestone: 'Health persisted',
         relatedIds: ['BERR-43', 'BERR-46'],
         prLinks: [
            { id: '#318', title: 'Persist project health', status: 'open' },
            { id: '#305', title: 'Add project health column', status: 'merged' },
         ],
      },
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Health persisted')).toBeInTheDocument();
      await expect(canvas.getByText('Diffs')).toBeInTheDocument();
   },
};
