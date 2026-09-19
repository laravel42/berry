import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { UserRound } from 'lucide-react';
import { expect, fn } from 'storybook/test';
import { useCreateIssueStore } from '@/store/create-issue-store';
import { useViewStore } from '@/store/view-store';
import { GroupIssues } from './group-issues';
import {
   issueApiHandlers,
   seedIssuesWorkspace,
   sharedFilter,
   statusById,
   transcriptEditor,
} from './stories-fixtures';

const todo = statusById('to-do');
const TodoIcon = todo.icon;

const meta = {
   component: GroupIssues,
   tags: ['ai-generated', 'needs-work'],
   args: {
      group: { id: todo.id, name: todo.name, icon: <TodoIcon />, status: todo },
      issues: [sharedFilter, transcriptEditor],
      count: 2,
      onDropIssue: fn(),
   },
   decorators: [
      (Story) => (
         <DndProvider backend={HTML5Backend}>
            <div className="h-[420px] w-[900px]">
               <Story />
            </div>
         </DndProvider>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace();
      useCreateIssueStore.getState().closeModal();
      msw.use(...issueApiHandlers);
   },
} satisfies Meta<typeof GroupIssues>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ListGroup: Story = {
   play: async ({ canvas, userEvent }) => {
      // Collapsing the group hides its rows; the header keeps the count.
      await userEvent.click(canvas.getByRole('button', { name: /Todo\s*2/ }));
      await expect(canvas.queryByText(sharedFilter.title)).toBeNull();
   },
};

export const CreateInGroup: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Create task in Todo' }));
      // The new task starts in the column it was asked from.
      await expect(useCreateIssueStore.getState().isOpen).toBe(true);
   },
};

export const EmptyListGroup: Story = { args: { issues: [], count: 0 } };

export const BoardColumn: Story = {
   beforeEach: () => {
      useViewStore.setState({ viewType: 'grid' });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Create task in Todo' })).toBeInTheDocument();
   },
};

export const EmptyBoardColumn: Story = {
   args: { issues: [], count: 0 },
   beforeEach: () => {
      useViewStore.setState({ viewType: 'grid' });
   },
};

export const AssigneeGroup: Story = {
   args: {
      group: { id: 'user-1', name: 'Andrea Lunelio', icon: <UserRound className="size-4" /> },
      issues: [sharedFilter],
      count: 1,
   },
};
