import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { parseUnifiedDiff } from '@/lib/reviews';
import { DiffView } from './diff-view';
import { unifiedDiff } from './review-fixtures';

const [newFile, editedFile] = parseUnifiedDiff(unifiedDiff);

const meta = {
   component: DiffView,
   tags: ['ai-generated', 'needs-work'],
   args: { diff: editedFile! },
   decorators: [
      (Story) => (
         <div className="w-[760px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof DiffView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two hunks with the lines between them collapsed. */
export const EditedFile: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('projects.ts')).toBeVisible();
      await expect(canvas.getByText(/unchanged lines/)).toBeVisible();
   },
};

export const NewFile: Story = { args: { diff: newFile! } };

/** A binary file or a pure rename arrives with no lines. */
export const NoContent: Story = {
   args: {
      diff: {
         name: 'berry-mark.png',
         path: 'frontend/public',
         additions: 0,
         deletions: 0,
         lines: [],
      },
   },
};
