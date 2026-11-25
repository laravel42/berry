import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor } from 'storybook/test';
import type { SiteBuild } from '@/lib/site-build';
import { SitePreview } from './site-preview';

interface Fixture {
   issueRef: string;
   artifact: { id: string; path: string; text: string };
   build: SiteBuild;
}

function fixture(issueRef: string, path: string, text: string, build: SiteBuild): Fixture {
   return {
      issueRef,
      artifact: { id: `art-${issueRef}`, path, text },
      build,
   };
}

const IDLE: SiteBuild = {
   available: true,
   state: 'idle',
   log: '',
   startedAt: null,
   finishedAt: null,
};

function handlersFor(fixture: Fixture) {
   const artifacts = [
      {
         id: fixture.artifact.id,
         path: fixture.artifact.path,
         name: fixture.artifact.path.split('/').at(-1)!,
         directory: '',
         contentType: 'text/html',
         sizeBytes: fixture.artifact.text.length,
         runId: 'run-1',
         agentName: 'Frontend Engineer',
         downloadUrl: `/api/v1/artifacts/${fixture.artifact.id}/download`,
         createdAt: '2026-09-18T08:00:00Z',
      },
   ];
   return [
      http.get(`*/api/v1/issues/${fixture.issueRef}/artifacts`, () =>
         HttpResponse.json({ artifacts })
      ),
      http.get(`*/api/v1/artifacts/${fixture.artifact.id}/download`, () =>
         HttpResponse.text(fixture.artifact.text, { headers: { 'content-type': 'text/html' } })
      ),
      http.post(`*/api/v1/issues/${fixture.issueRef}/artifacts/preview`, () =>
         HttpResponse.json({ baseUrl: `https://preview.berry.test/${fixture.issueRef}/` })
      ),
      http.get(`*/api/v1/issues/${fixture.issueRef}/artifacts/preview/build`, () =>
         HttpResponse.json(IDLE)
      ),
      http.post(`*/api/v1/issues/${fixture.issueRef}/artifacts/preview/build`, () =>
         HttpResponse.json(fixture.build)
      ),
   ];
}

const meta = {
   component: SitePreview,
   tags: ['ai-generated'],
   beforeEach: () => {
      window.localStorage.removeItem('berry:preview-terminal');
   },
} satisfies Meta<typeof SitePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing the agents produced is a page: there is no site to preview. */
export const NoSite: Story = {
   args: { issueRef: 'SITE-NONE' },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/issues/SITE-NONE/artifacts', () => HttpResponse.json({ artifacts: [] }))
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('This task has no page to preview.')).toBeVisible();
   },
};

/** The server could not read the task's files: the preview says so rather than staying blank. */
export const LoadFailed: Story = {
   args: { issueRef: 'SITE-FAILED' },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/issues/SITE-FAILED/artifacts', () =>
            HttpResponse.json({ error: { code: 'INTERNAL', message: 'boom' } }, { status: 500 })
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('The preview could not be opened.')).toBeVisible();
   },
};

/** A build tool's source: Berry installs and builds it in a container before anything can show. */
export const Building: Story = {
   args: { issueRef: 'SITE-BUILDING' },
   beforeEach: ({ msw }) => {
      msw.use(
         ...handlersFor(
            fixture(
               'SITE-BUILDING',
               'index.html',
               '<html><body><script type="module" src="/src/main.tsx"></script></body></html>',
               {
                  available: true,
                  state: 'building',
                  log: 'npm install\n',
                  startedAt: '2026-09-18T12:00:00Z',
                  finishedAt: null,
               }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await waitFor(async () => {
         expect(
            await canvas.findByText(/Berry is installing the project's packages/)
         ).toBeVisible();
      });
   },
};

/** Already a plain page: shown at once, no build step in the way. */
export const BuiltReady: Story = {
   args: { issueRef: 'SITE-READY' },
   beforeEach: ({ msw }) => {
      msw.use(
         ...handlersFor(
            fixture(
               'SITE-READY',
               'index.html',
               '<html><body><h1>Hello from the task</h1></body></html>',
               { available: true, state: 'ready', log: '', startedAt: null, finishedAt: null }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await waitFor(async () =>
         expect(await canvas.findByRole('button', { name: 'Reload the page' })).toBeEnabled()
      );
   },
};
