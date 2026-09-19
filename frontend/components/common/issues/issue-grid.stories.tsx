import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { expect } from 'storybook/test';
import { CustomDragLayer, IssueGrid } from './issue-grid';
import {
   approvalsInbox,
   healthTests,
   issueApiHandlers,
   persistHealth,
   rotateKey,
   seedIssuesWorkspace,
   sharedFilter,
} from './stories-fixtures';

const column = [persistHealth, approvalsInbox, sharedFilter].map((issue) => issue.id);

const meta = {
   component: IssueGrid,
   tags: ['ai-generated', 'needs-work'],
   args: {
      issue: sharedFilter,
      index: 2,
      columnIssueIds: column,
      columnStatus: sharedFilter.status,
   },
   decorators: [
      (Story) => (
         <DndProvider backend={HTML5Backend}>
            <CustomDragLayer />
            <div
               className="w-[278px] rounded-lg p-1.5"
               style={{ backgroundColor: 'var(--board-column-body)' }}
            >
               <Story />
            </div>
         </DndProvider>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace({ layout: 'grid' });
      msw.use(...issueApiHandlers);
   },
} satisfies Meta<typeof IssueGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Card: Story = {
   play: async ({ canvas }) => {
      // The title is a level-4 heading so a board is skimmable by screen reader.
      await expect(
         canvas.getByRole('heading', { level: 4, name: 'Share the list filter through the URL' })
      ).toBeInTheDocument();
      await expect(canvas.getByText('BERR-44')).toBeInTheDocument();
   },
};

export const AgentAtWork: Story = {
   args: { issue: persistHealth, index: 0 },
   play: async ({ canvas }) => {
      await expect(canvas.getByTitle('Backend Engineer is working on this')).toBeInTheDocument();
   },
};

export const InReview: Story = { args: { issue: approvalsInbox, index: 1 } };
export const BlockedWithTwoLabels: Story = { args: { issue: rotateKey, index: 0 } };
export const NoAssignee: Story = { args: { issue: healthTests, index: 0 } };

export const LongTitle: Story = {
   args: {
      issue: {
         ...sharedFilter,
         title: 'Keep the shared list filter in the URL when a saved view is opened from the rail, and restore it after a reload without losing the grouping',
      },
   },
};
