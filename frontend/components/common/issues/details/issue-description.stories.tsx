import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import { IssueDescription } from './issue-description';
import {
   attachment,
   attachmentDownloadHandler,
   emptyPage,
   issueApiHandlers,
   persistHealth,
   seedIssuesWorkspace,
} from '../stories-fixtures';

const markdown = `The health chip has only ever lived in the browser, so a reload forgets it.

## Plan

- add a \`health\` column and migration 061
- \`PATCH /api/v1/projects/{id}\` accepts \`health\`
- record every change as a project update

The review gate stays: an agent may propose a health change, a person keeps it.`;

const attachments = (nodes: ReturnType<typeof attachment>[]) =>
   http.get('*/api/v1/issues/:ref/attachments', () =>
      HttpResponse.json({ nodes, pageInfo: emptyPage })
   );

const meta = {
   component: IssueDescription,
   tags: ['ai-generated', 'needs-work'],
   args: {
      issueId: persistHealth.id,
      issueRef: persistHealth.identifier,
      description: markdown,
   },
   decorators: [
      (Story) => (
         <div className="w-[720px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace();
      msw.use(attachments([]), attachmentDownloadHandler, ...issueApiHandlers);
   },
} satisfies Meta<typeof IssueDescription>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Markdown: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('heading', { name: 'Plan' })).toBeInTheDocument();
   },
};

export const Empty: Story = {
   args: { description: '' },
};

export const WithScreenshots: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         attachments([
            attachment('att-health-before', 'health-chip-before.png', 'image/png', 184_220),
            attachment('att-health-after', 'health-chip-after.png', 'image/png', 201_004),
            attachment('att-log', 'migration-061.log', 'text/plain', 4_210),
         ])
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      // Only images get a chip under the text; the log stays in Files.
      await userEvent.click(await canvas.findByRole('button', { name: 'health-chip-after.png' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText(/health-chip-after\.png · 2 of 2/)).toBeVisible();
   },
};
