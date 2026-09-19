import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { ContentBlocks, InlineText, IssueRefRow } from './content-blocks';
import { seedIssuesWorkspace } from '../stories-fixtures';

const meta = {
   component: ContentBlocks,
   tags: ['ai-generated', 'needs-work'],
   args: {
      blocks: [
         { type: 'heading', level: 1, text: 'Why the chip forgets' },
         {
            type: 'paragraph',
            text: 'Health is computed in `projects-store` and **never written back**, so a reload shows *No update* again. See [the ADR](https://example.com/adr-0014).',
         },
         {
            type: 'bullet-list',
            items: [
               'Add a `health` column',
               'Record each change as an update',
               '~~Poll the board~~',
            ],
         },
         {
            type: 'checklist',
            items: [
               { text: 'Migration 061', checked: true },
               { text: 'PATCH /api/v1/projects/{id}', checked: false },
            ],
         },
         { type: 'code', language: 'sql', code: 'ALTER TABLE projects ADD COLUMN health text;' },
         {
            type: 'quote',
            text: 'A health chip that resets is worse than none.',
            author: 'Maya Chen',
         },
         { type: 'divider' },
         { type: 'issue-ref', identifier: 'BERR-46', note: 'waits on this' },
      ],
   },
   decorators: [
      (Story) => (
         <div className="w-[720px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: () => {
      seedIssuesWorkspace();
   },
} satisfies Meta<typeof ContentBlocks>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Document: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('never written back').tagName).toBe('STRONG');
      await expect(canvas.getByRole('link', { name: 'the ADR' })).toHaveAttribute(
         'target',
         '_blank'
      );
      // A task reference is drawn with that task's current title from the store.
      await expect(canvas.getByText('Rotate the integration encryption key')).toBeInTheDocument();
   },
};

export const Media: Story = {
   args: {
      blocks: [
         { type: 'numbered-list', items: ['Open a project', 'Change its health', 'Reload'] },
         {
            type: 'image',
            alt: 'The health chip after a reload',
            caption: 'Expected',
            aspect: 'video',
         },
         { type: 'video', title: 'Reproduction.mov', duration: '0:42' },
      ],
   },
};

export const UnknownTaskReference: Story = {
   args: { blocks: [{ type: 'issue-ref', identifier: 'BERR-900' }] },
};

export const Inline: Story = {
   render: () => (
      <p>
         <InlineText text="Run `pnpm check:models`, then **commit** — *not* before." />
      </p>
   ),
};

export const RelatedRow: Story = {
   render: () => (
      <div className="w-[260px]">
         <IssueRefRow identifier="BERR-43" />
         <IssueRefRow identifier="BERR-44" />
      </div>
   ),
};
