import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { IssueDetailsSection } from './issue-details-section';
import { agentUser, backendAgent, persistHealth, seedIssuesWorkspace } from '../stories-fixtures';

const meta = {
   component: IssueDetailsSection,
   tags: ['ai-generated', 'needs-work'],
   args: { issue: persistHealth },
   decorators: [
      (Story) => (
         <div className="w-[260px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: () => {
      seedIssuesWorkspace();
   },
} satisfies Meta<typeof IssueDetailsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FiledByAPerson: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Andrea Lunelio')).toBeInTheDocument();
      // date-fns prints in the browser's own zone, so only the day is fixed.
      await expect(canvas.getByText(/^8 Sep 2026, \d{2}:\d{2}$/)).toBeInTheDocument();
   },
};

export const FiledByAnAgent: Story = {
   args: { issue: { ...persistHealth, createdBy: agentUser(backendAgent) } },
};

export const UnknownAuthor: Story = {
   args: { issue: { ...persistHealth, createdBy: null, updatedAt: undefined } },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Unknown')).toBeInTheDocument();
      await expect(canvas.queryByText('Updated')).toBeNull();
   },
};
