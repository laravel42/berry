import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import { SiteBuildFrame } from './site-build-frame';

const status = (state: string, log = '') => ({
   available: true,
   state,
   log,
   startedAt: '2026-09-19T08:00:00Z',
   finishedAt: state === 'building' ? null : '2026-09-19T08:01:10Z',
});

const meta = {
   component: SiteBuildFrame,
   tags: ['ai-generated'],
   args: {
      issueRef: 'L42-400',
      pageUrl: '/api/v1/previews/token/index.html',
      base: '/api/v1/previews/token/',
      unbuilt: true,
      reload: 0,
      title: 'Page preview of index.html',
   },
   decorators: [
      (Story) => (
         <div className="h-[420px] w-[720px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof SiteBuildFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A plain page shows as it is, in the sandboxed webview, and nothing is built. */
export const PlainPage: Story = {
   args: { unbuilt: false },
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/artifacts/preview/build', () => {
            throw new Error('a plain page must not start a build');
         })
      );
   },
   play: async ({ canvas }) => {
      const frame = canvas.getByTitle('Page preview of index.html');
      await expect(frame.getAttribute('src')).toBe('/api/v1/previews/token/index.html');
      await expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
   },
};

/** A source page starts its build by itself and shows the log as it runs. */
export const Building: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/artifacts/preview/build', () =>
            HttpResponse.json(status('building', '$ npm install\nadded 392 packages in 1m\n'), {
               status: 202,
            })
         ),
         http.get('*/artifacts/preview/build', () =>
            HttpResponse.json(status('building', '$ npm install\n'))
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('status')).toHaveTextContent('Building the site');
      await expect(await canvas.findByText(/added 392 packages/)).toBeVisible();
   },
};

/** Once built, the built site runs in the webview. */
export const Built: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/artifacts/preview/build', () =>
            HttpResponse.json(status('ready'), { status: 202 })
         )
      );
   },
   play: async ({ canvas }) => {
      const frame = await canvas.findByTitle('Page preview of index.html');
      await expect(frame.getAttribute('src')).toBe('/api/v1/previews/token/__build__/index.html');
      await expect(canvas.getByRole('button', { name: 'Rebuild' })).toBeVisible();
   },
};

/** A failed build says so with the end of its log, and can be retried. */
export const Failed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/artifacts/preview/build', () =>
            HttpResponse.json(
               status('failed', 'error TS2307: Cannot find module\nThe build failed (exit 1).'),
               {
                  status: 202,
               }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('alert')).toHaveTextContent('could not be built');
      await expect(canvas.getByText(/exit 1/)).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible();
   },
};

/** Without Docker the server cannot build, and says so. */
export const NoDocker: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/artifacts/preview/build', () =>
            HttpResponse.json(
               {
                  error: {
                     code: 'BUILDS_UNAVAILABLE',
                     message: 'no docker',
                     requestId: 'r',
                     details: null,
                  },
               },
               { status: 503 }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText(/Docker is not available/)).toBeVisible();
   },
};
