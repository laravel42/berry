import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import type { PreviewEnvironment } from '@/lib/preview-environment';
import { EnvironmentPreview } from './environment-preview';

const path = '*/api/v1/issues/BERR-1/preview-environment';

const BASE: PreviewEnvironment = {
   available: true,
   previewable: true,
   state: 'idle',
   commit: 'a1b2c3d',
   plan: null,
   url: null,
   log: '',
   message: null,
   failure: null,
   startedAt: null,
};

const meta = {
   component: EnvironmentPreview,
   tags: ['ai-generated'],
   args: { issueRef: 'BERR-1' },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'berry']] } } },
   beforeEach: () => {
      window.localStorage.removeItem('berry:preview-terminal');
   },
} satisfies Meta<typeof EnvironmentPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Still reading where the preview stands: the loading mark, not a blank pane. */
export const Loading: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get(path, () => new Promise<Response>(() => {})));
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Loading…')).toBeVisible();
   },
};

/** No run has delivered a commit yet: nothing to preview, and no preview to start. */
export const NothingYet: Story = {
   beforeEach: ({ msw }) => {
      const env: PreviewEnvironment = { ...BASE, previewable: false };
      msw.use(http.get(path, () => HttpResponse.json(env)));
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText(
            "Nothing to preview yet. A preview runs the task's pull request, and no run has delivered a commit."
         )
      ).toBeVisible();
   },
};

/** Up and answering: the toolbar's Open, Reload, Rebuild and Stop all work on it. */
export const Ready: Story = {
   beforeEach: ({ msw }) => {
      const env: PreviewEnvironment = {
         ...BASE,
         state: 'ready',
         plan: {
            source: 'manifest',
            apps: [
               {
                  name: 'web',
                  kind: 'web',
                  primary: true,
                  url: 'https://berr-1.preview.berry.test/',
                  ready: true,
               },
            ],
            services: [],
         },
      };
      msw.use(http.get(path, () => HttpResponse.json(env)));
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('link', { name: 'Open in a new tab' })).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Reload the page' })).toBeEnabled();
      await expect(canvas.getByRole('button', { name: 'Stop the preview' })).toBeEnabled();
   },
};

/** A code failure: "Fix with AI" sends the task's agent back in with this log. */
export const Failed: Story = {
   beforeEach: ({ msw }) => {
      const env: PreviewEnvironment = {
         ...BASE,
         state: 'failed',
         failure: 'code',
         message: null,
         log: 'npm ERR! missing script: start\n',
      };
      msw.use(http.get(path, () => HttpResponse.json(env)));
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('The preview did not start.')).toBeVisible();
      await expect(canvas.getByRole('button', { name: /Fix with AI/ })).toBeEnabled();
   },
};
