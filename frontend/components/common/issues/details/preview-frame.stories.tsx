import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import { PreviewFrame } from './preview-frame';

const meta = {
   component: PreviewFrame,
   tags: ['ai-generated'],
   args: { src: 'https://preview.berry.test/app/', title: 'Preview of web' },
} satisfies Meta<typeof PreviewFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Before the page is fetched: the Berry mark, not an empty frame. */
export const Loading: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('https://preview.berry.test/app/', () => new Promise<Response>(() => {})));
   },
   play: async ({ canvasElement }) => {
      await expect(canvasElement.querySelector('iframe')).toBeNull();
   },
};

/** A small page (one script, one stylesheet): fetched from Berry and inlined into a sandboxed `srcDoc`. */
export const Inlined: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('https://preview.berry.test/app/', () =>
            HttpResponse.text(
               '<html><head><link rel="stylesheet" href="/app.css"></head><body><script type="module" src="/app.js"></script></body></html>',
               { headers: { 'content-type': 'text/html' } }
            )
         ),
         http.get('https://preview.berry.test/app.css', () =>
            HttpResponse.text('body { color: red; }', { headers: { 'content-type': 'text/css' } })
         ),
         http.get('https://preview.berry.test/app.js', () =>
            HttpResponse.text('console.log("hi")', {
               headers: { 'content-type': 'text/javascript' },
            })
         )
      );
   },
   play: async ({ canvasElement }) => {
      const iframe = await new Promise<HTMLIFrameElement>((resolve) => {
         const check = () => {
            const found = canvasElement.querySelector('iframe');
            if (found) resolve(found as HTMLIFrameElement);
            else setTimeout(check, 50);
         };
         check();
      });
      await expect(iframe).toHaveAttribute('srcdoc');
      await expect(iframe).toHaveAttribute(
         'sandbox',
         'allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock'
      );
   },
};

/**
 * The host refuses or times out: inlining gives up and the page is framed at
 * its own address instead — never a blank pane.
 */
export const Unreachable: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('https://preview.berry.test/app/', () => HttpResponse.error()));
   },
   play: async ({ canvasElement }) => {
      const iframe = await new Promise<HTMLIFrameElement>((resolve) => {
         const check = () => {
            const found = canvasElement.querySelector('iframe');
            if (found) resolve(found as HTMLIFrameElement);
            else setTimeout(check, 50);
         };
         check();
      });
      await expect(iframe).toHaveAttribute('src', 'https://preview.berry.test/app/');
      await expect(iframe).not.toHaveAttribute('srcdoc');
   },
};

/** A page already on Berry's origin: framed directly, sandboxed the same way, no inlining attempted. */
export const Sandboxed: Story = {
   args: { sandboxed: true },
   play: async ({ canvasElement }) => {
      const iframe = canvasElement.querySelector('iframe');
      await expect(iframe).toHaveAttribute(
         'sandbox',
         'allow-scripts allow-forms allow-popups allow-modals'
      );
      await expect(iframe).toHaveAttribute('src', 'https://preview.berry.test/app/');
   },
};
