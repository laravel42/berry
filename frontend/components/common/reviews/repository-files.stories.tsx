import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor } from 'storybook/test';
import { forgetRepositoryTree } from '@/lib/reviews';
import { RepositoryFiles } from './repository-files';

const RUN_ID = 'run-42-1';

const tree = {
   repository: 'berry-dev/berry',
   branch: 'berr-44-health-popover',
   commit: '4ef7b29c91a1',
   files: [
      { path: 'projects.ts', sha: 'sha-1', size: 18_404 },
      { path: 'projects.test.ts', sha: 'sha-2', size: 9_870 },
   ],
   changes: [
      { path: 'projects.ts', status: 'modified' },
      { path: 'projects.test.ts', status: 'added' },
   ],
};

const meta = {
   component: RepositoryFiles,
   tags: ['ai-generated', 'needs-work'],
   args: { issueRef: 'BERR-44', runId: RUN_ID },
   decorators: [
      (Story) => (
         <div className="h-[560px] w-[720px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      // `loadRepositoryTree` keeps a module-level cache keyed by run id, so a
      // tree fetched by an earlier story must be forgotten before the next one.
      forgetRepositoryTree(RUN_ID);
      msw.use(http.get('*/api/v1/reviews/:runId/tree', () => HttpResponse.json(tree)));
   },
} satisfies Meta<typeof RepositoryFiles>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The branch's own tree, not just the pull request's diff — every file, with what changed marked. */
export const BranchTree: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByTitle('Preview projects.ts')).toBeVisible();
      await expect(canvas.getByTitle('Preview projects.test.ts')).toBeVisible();
   },
};

/** Opening a file reads its content through the review's own blob route. */
export const OpeningAFileReadsItsBlob: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get(
            '*/api/v1/reviews/:runId/blob/:sha',
            ({ params }) =>
               new HttpResponse(
                  params.sha === 'sha-1' ? 'export function projectsRouter() {}\n' : '',
                  { headers: { 'content-type': 'text/plain' } }
               )
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByTitle('Preview projects.ts'));
      await waitFor(() =>
         expect(canvasElement.querySelector('.cm-content')).toHaveTextContent(
            'export function projectsRouter() {}'
         )
      );
   },
};

/** The tree could not be read: the page says so instead of showing an empty browser. */
export const TreeFailedToLoad: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/reviews/:runId/tree', () => HttpResponse.error()));
   },
   play: async ({ canvas }) => {
      const alert = await canvas.findByRole('alert');
      await expect(alert).not.toBeEmptyDOMElement();
   },
};
