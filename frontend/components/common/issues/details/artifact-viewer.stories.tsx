import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import type { RunArtifact } from '@/lib/attachments';
import { IssueArtifacts } from './issue-artifacts';

const artifact = (
   id: string,
   path: string,
   contentType = 'text/plain; charset=utf-8'
): RunArtifact => {
   const segments = path.split('/');
   return {
      id,
      path,
      name: segments.at(-1) ?? path,
      directory: segments.slice(0, -1).join('/'),
      contentType,
      sizeBytes: 1_024,
      runId: 'run-7',
      agentName: 'Frontend Engineer',
      downloadUrl: `/api/v1/artifacts/${id}/download`,
      createdAt: '2026-09-19T08:00:00Z',
   };
};

/** An agent's output as it is stored: everything text/plain, the extension says the rest. */
const produced = [
   artifact('doc', 'docs/README.md'),
   artifact('page', 'site/index.html'),
   artifact('css', 'site/style.css'),
   artifact('logo', 'site/logo.svg'),
   artifact('code', 'site/app.ts'),
   artifact('bin', 'build/output.bin', 'application/octet-stream'),
];

const bodies: Record<string, string> = {
   doc: '# Landing page\n\nBuilt for **launch**.\n\n| Section | Status |\n| --- | --- |\n| Hero | done |\n| Pricing | draft |\n',
   page: '<!doctype html><link rel="stylesheet" href="style.css"><h1>Hello</h1>',
   css: 'h1 { color: tomato; }',
   logo: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
   code: 'export const answer: number = 42;\n',
};

const meta = {
   component: IssueArtifacts,
   tags: ['ai-generated'],
   args: { issueRef: 'BER-7', defaultOpen: true },
   decorators: [
      (Story) => (
         <div className="w-[720px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/issues/:ref/artifacts', () =>
            HttpResponse.json({ artifacts: produced })
         ),
         http.get('*/api/v1/artifacts/:id/download', ({ params }) =>
            HttpResponse.text(bodies[String(params.id)] ?? '', {
               headers: { 'content-type': 'text/plain; charset=utf-8' },
            })
         ),
         http.post('*/api/v1/issues/:ref/artifacts/preview', () =>
            HttpResponse.json({
               baseUrl: '/api/v1/previews/token-abc/',
               expiresAt: '2026-09-19T09:00:00Z',
            })
         )
      );
   },
} satisfies Meta<typeof IssueArtifacts>;

export default meta;
type Story = StoryObj<typeof meta>;

const dialog = async (canvasElement: HTMLElement) =>
   within(await within(canvasElement.ownerDocument.body).findByRole('dialog'));

/** A markdown document opens formatted — tables included — and flips to its source. */
export const MarkdownDocument: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Preview docs/README.md' }));
      const viewer = await dialog(canvasElement);
      await expect(await viewer.findByRole('heading', { name: 'Landing page' })).toBeVisible();
      await expect(viewer.getByRole('cell', { name: 'Pricing' })).toBeVisible();
      await userEvent.click(viewer.getByRole('button', { name: 'Source' }));
      await expect(await viewer.findByText(/# Landing page/)).toBeVisible();
   },
};

/** A site opens its entry page in a sandboxed webview under the preview base. */
export const SitePreview: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Preview site' }));
      const viewer = await dialog(canvasElement);
      const frame = (await viewer.findByTitle(
         'Page preview of site/index.html'
      )) as HTMLIFrameElement;
      await expect(frame.getAttribute('src')).toBe('/api/v1/previews/token-abc/site/index.html');
      // Scripts run; same-origin access never does.
      await expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
      await expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
   },
};

/** An SVG stored as text still shows as an image; code gets the code view; the arrows walk the tree. */
export const ImageAndCode: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Preview site/logo.svg' }));
      const viewer = await dialog(canvasElement);
      const image = (await viewer.findByRole('img', { name: 'site/logo.svg' })) as HTMLImageElement;
      await expect(image.src).toMatch(/^blob:/);
      // The tree lists a folder's files by name: after logo.svg comes style.css.
      await userEvent.click(viewer.getByRole('button', { name: 'Next file' }));
      await expect(await viewer.findByTitle('site/style.css')).toBeVisible();
      await expect(await viewer.findByText(/tomato/)).toBeVisible();
   },
};

/** A file with no viewer offers only the download. */
export const NoPreviewForBinary: Story = {
   play: async ({ canvas }) => {
      await canvas.findByText('output.bin');
      await expect(canvas.queryByRole('button', { name: 'Preview build/output.bin' })).toBeNull();
      await expect(canvas.getByRole('button', { name: 'Download build/output.bin' })).toBeVisible();
   },
};

/** A build tool's source page says why it may render blank, instead of showing a white frame. */
export const SourcePageNeedsBuild: Story = {
   beforeEach: ({ msw }) => {
      bodies.page =
         '<!doctype html><div id="root"></div><script type="module" src="/src/main.tsx"></script>';
      msw.use(
         http.get('*/api/v1/artifacts/:id/download', ({ params }) =>
            HttpResponse.text(bodies[String(params.id)] ?? '')
         ),
         // A source page is built in a container before it is shown.
         http.post('*/api/v1/issues/:ref/artifacts/preview/build', () =>
            HttpResponse.json(
               { available: true, state: 'building', log: '$ npm install\n', startedAt: null, finishedAt: null },
               { status: 202 }
            )
         )
      );
      return () => {
         bodies.page = '<!doctype html><link rel="stylesheet" href="style.css"><h1>Hello</h1>';
      };
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Preview site' }));
      const viewer = await dialog(canvasElement);
      await expect(await viewer.findByRole('status')).toHaveTextContent(/Building the site/);
   },
};
