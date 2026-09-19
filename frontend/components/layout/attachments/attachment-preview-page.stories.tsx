import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import type { ApiAttachment } from '@/lib/attachments';
import { AttachmentPreviewPage } from './attachment-preview-page';

const report: ApiAttachment = {
   id: 'att-1',
   issueId: 'issue-42',
   commentId: null,
   fileName: 'coverage-report.html',
   contentType: 'text/html',
   sizeBytes: 18_432,
   uploader: { type: 'agent', id: 'agent-1', name: 'Backend Engineer', avatarUrl: null },
   downloadUrl: '/api/v1/attachments/att-1/download',
   createdAt: '2026-09-18T10:12:00Z',
};

const REPORT_HTML = `<!doctype html><html><body style="font-family:sans-serif;padding:24px">
<h1>Coverage: server-ts</h1><p>Statements 87.4% · Branches 79.1% · Functions 90.2%</p>
<script>document.body.innerHTML = 'scripts are blocked';</script></body></html>`;

const MIGRATION_LOG = `$ pnpm migrate:server
applying 0041_project_updates.sql … ok
applying 0042_project_health.sql … ok
2 migrations applied in 184ms`;

/** Answers the metadata call and the download for one attachment. */
function serve(attachment: ApiAttachment | null, body: BodyInit, contentType: string) {
   return [
      http.get('*/api/v1/attachments/:id', () =>
         attachment
            ? HttpResponse.json(attachment)
            : HttpResponse.json(
                 { code: 'NOT_FOUND', message: 'Attachment not found', details: null },
                 { status: 404 }
              )
      ),
      http.get(
         '*/api/v1/attachments/:id/download',
         () => new HttpResponse(body, { headers: { 'content-type': contentType } })
      ),
   ];
}

const meta = {
   component: AttachmentPreviewPage,
   tags: ['ai-generated', 'needs-work'],
   args: { attachmentId: 'att-1' },
   parameters: { layout: 'fullscreen' },
   decorators: [
      (Story) => (
         <div className="flex h-[560px] flex-col bg-container">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AttachmentPreviewPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An agent's HTML report, shown in an iframe with every sandbox permission withheld. */
export const HtmlReport: Story = {
   beforeEach: ({ msw }) => {
      msw.use(...serve(report, REPORT_HTML, 'text/html'));
   },
   play: async ({ canvas }) => {
      const frame = await canvas.findByTitle('coverage-report.html');
      await expect(frame).toHaveAttribute('sandbox', '');
      await expect(
         canvas.getByText('This page is shown with scripts and navigation switched off.')
      ).toBeVisible();
   },
};

export const TextLog: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         ...serve(
            { ...report, fileName: 'migrate.log', contentType: 'text/plain', sizeBytes: 164 },
            MIGRATION_LOG,
            'text/plain'
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText(/2 migrations applied/)).toBeVisible();
      await expect(canvas.getByText('164 B')).toBeVisible();
   },
};

export const TooLarge: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         ...serve(
            {
               ...report,
               fileName: 'trace.json',
               contentType: 'application/json',
               sizeBytes: 48 * 1024 * 1024,
            },
            '{}',
            'application/json'
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('This file is too large to preview. Download it instead.')
      ).toBeVisible();
   },
};

export const NotFound: Story = {
   beforeEach: ({ msw }) => {
      msw.use(...serve(null, '', 'text/plain'));
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('That file is not here, or is not yours to open.')
      ).toBeVisible();
   },
};
