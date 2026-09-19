import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, within } from 'storybook/test';
import type { ApiAttachment } from '@/lib/attachments';
import { AttachmentPreview } from './attachment-preview';

const uploader = { type: 'user' as const, id: 'user-1', name: 'Elian Rossi', avatarUrl: null };

const attachment = (
   fields: Partial<ApiAttachment> & Pick<ApiAttachment, 'id' | 'fileName' | 'contentType'>
): ApiAttachment => ({
   issueId: 'issue-42',
   commentId: null,
   sizeBytes: 2_048,
   uploader,
   downloadUrl: `/api/v1/attachments/${fields.id}/download`,
   createdAt: '2026-09-18T10:12:00Z',
   ...fields,
});

const files: ApiAttachment[] = [
   attachment({
      id: 'att-log',
      fileName: 'migrate.log',
      contentType: 'text/plain',
      sizeBytes: 164,
   }),
   attachment({
      id: 'att-png',
      fileName: 'health-chip.png',
      contentType: 'image/png',
      sizeBytes: 3_210,
   }),
   attachment({ id: 'att-html', fileName: 'coverage-report.html', contentType: 'text/html' }),
   attachment({
      id: 'att-zip',
      fileName: 'artifacts.zip',
      contentType: 'application/zip',
      sizeBytes: 9_400_000,
   }),
];

/** A few PNG bytes, so the image path has a blob to hand the <img>. */
const PNG = Uint8Array.from(
   atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=='
   ),
   (char) => char.charCodeAt(0)
);

const meta = {
   component: AttachmentPreview,
   tags: ['ai-generated', 'needs-work'],
   args: { attachments: files, index: 0, onIndexChange: fn(), orgId: 'elian' },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/attachments/att-log/download', () =>
            HttpResponse.text(
               'applying 0041_project_updates.sql … ok\napplying 0042_project_health.sql … ok\n2 migrations applied in 184ms'
            )
         ),
         // The modal still reads an HTML file's bytes, though it only links out.
         http.get('*/api/v1/attachments/att-html/download', () =>
            HttpResponse.html('<!doctype html><h1>Coverage: server-ts</h1>')
         ),
         http.get(
            '*/api/v1/attachments/att-png/download',
            () => new HttpResponse(PNG, { headers: { 'content-type': 'image/png' } })
         )
      );
   },
} satisfies Meta<typeof AttachmentPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TextFile: Story = {
   play: async ({ canvasElement, args, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = await body.findByRole('dialog', { name: 'Preview of migrate.log' });
      await expect(await within(dialog).findByText(/2 migrations applied/)).toBeVisible();
      // The arrows walk the list and wrap at either end.
      await userEvent.click(within(dialog).getByRole('button', { name: 'Previous file' }));
      await expect(args.onIndexChange).toHaveBeenCalledWith(3);
   },
};

export const Image: Story = {
   args: { index: 1 },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('img', { name: 'health-chip.png' })).toBeInTheDocument();
      await expect(body.getByRole('button', { name: 'Zoom in' })).toBeVisible();
   },
};

/** HTML is never inlined here; it opens on its own sandboxed page. */
export const HtmlReport: Story = {
   args: { index: 2 },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(
         await body.findByRole('link', { name: 'Open the full preview' })
      ).toHaveAttribute('target', '_blank');
   },
};

export const Unsupported: Story = {
   args: { index: 3 },
   play: async ({ canvasElement, args, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(
         await body.findByText('There is no preview for this kind of file.')
      ).toBeVisible();
      await userEvent.click(body.getByRole('button', { name: 'Close the preview' }));
      await expect(args.onIndexChange).toHaveBeenCalledWith(null);
   },
};
