import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor } from 'storybook/test';
import type { RunArtifact } from '@/lib/attachments';
import { IssueArtifacts } from './issue-artifacts';

const artifact = (
   id: string,
   path: string,
   sizeBytes: number,
   runId = 'run-42-1',
   agentName = 'Backend Engineer'
): RunArtifact => {
   const segments = path.split('/');
   return {
      id,
      path,
      name: segments.at(-1) ?? path,
      directory: segments.slice(0, -1).join('/'),
      contentType: 'text/plain',
      sizeBytes,
      runId,
      agentName,
      downloadUrl: `/api/v1/artifacts/${id}/download`,
      createdAt: '2026-09-18T10:06:00Z',
   };
};

const produced = [
   artifact('a1', 'server-ts/migrations/061_project_health.sql', 612),
   artifact('a2', 'server-ts/src/core/projects.ts', 18_404),
   artifact('a3', 'server-ts/src/core/projects.test.ts', 9_870),
   artifact('a4', 'frontend/store/projects-store.ts', 7_112, 'run-42-2', 'Frontend Engineer'),
];

const answer = (artifacts: RunArtifact[]) =>
   http.get('*/api/v1/issues/:ref/artifacts', () => HttpResponse.json({ artifacts }));

const meta = {
   component: IssueArtifacts,
   tags: ['ai-generated', 'needs-work'],
   args: { issueRef: 'BERR-42' },
   decorators: [
      (Story) => (
         <div className="w-[720px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      msw.use(answer(produced));
   },
} satisfies Meta<typeof IssueArtifacts>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FoldedByDefault: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(await canvas.findByText('Produced · 4 files')).toBeInTheDocument();
      await expect(canvas.getByText('by Backend Engineer, Frontend Engineer')).toBeInTheDocument();
      await userEvent.click(canvas.getByRole('button', { name: 'Show files' }));
      await expect(canvas.getByText('061_project_health.sql')).toBeInTheDocument();
   },
};

export const Unfolded: Story = {
   args: { defaultOpen: true },
   play: async ({ canvas, userEvent }) => {
      // Folders fold on their own.
      const folder = await canvas.findByRole('button', { name: /server-ts/ });
      await userEvent.click(folder);
      await expect(folder).toHaveAttribute('aria-expanded', 'false');
      await expect(canvas.queryByText('projects.test.ts')).toBeNull();
   },
};

export const OneRunInReview: Story = {
   args: { heading: null, runId: 'run-42-1', onLoaded: fn() },
   play: async ({ args, canvas }) => {
      await expect(await canvas.findByText('projects.ts')).toBeInTheDocument();
      await expect(canvas.queryByText('projects-store.ts')).toBeNull();
      await waitFor(() =>
         expect(args.onLoaded).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ id: 'a1' })])
         )
      );
   },
};

export const NothingProduced: Story = {
   beforeEach: ({ msw }) => {
      msw.use(answer([]));
   },
};
