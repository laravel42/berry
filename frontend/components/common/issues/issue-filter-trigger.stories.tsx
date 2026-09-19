import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { IssueFilterTrigger } from './issue-filter-trigger';
import { seedIssuesWorkspace } from './stories-fixtures';
import { urgentOnly, withUrlFilters } from './stories-filters';

const meta = {
   component: IssueFilterTrigger,
   tags: ['ai-generated', 'needs-work'],
   args: { iconOnly: false },
   decorators: [
      (Story) => (
         <div className="flex h-10 w-[640px] items-center justify-end border-b px-4">
            <Story />
         </div>
      ),
   ],
   beforeEach: () => {
      seedIssuesWorkspace();
   },
} satisfies Meta<typeof IssueFilterTrigger>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const IconOnly: Story = { args: { iconOnly: true } };

export const WithActiveFilter: Story = { decorators: [withUrlFilters(urgentOnly)] };

export const OpenFieldList: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: /filter/i }));
      // Fields come from the hydrated workspace: people, agents, labels, projects.
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Assignee')).toBeVisible();
      await expect(body.getByText('Labels')).toBeVisible();
   },
};
