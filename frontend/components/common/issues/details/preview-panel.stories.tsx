import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, within } from 'storybook/test';
import type { PreviewEnvFile } from '@/lib/preview-environment';
import { PreviewPanel } from './preview-panel';

const LOG = [
   'Fetching commit a1b2c3d…',
   'Installing…',
   '[web] npm run dev',
   '[web] > next dev',
   './app/page.tsx:12:7',
   "Type error: Property 'count' does not exist on type 'Props'.",
].join('\n');

const meta = {
   component: PreviewPanel,
   tags: ['ai-generated'],
   args: {
      log: LOG,
      processes: [{ name: 'web', ready: true, workdir: '/work' }],
      issueRef: 'BERR-1',
      host: 'berr-1',
      status: 'ready · commit a1b2c3d · web ✓',
      running: true,
      onAction: fn(),
      onClose: fn(),
      onExec: fn(() => Promise.resolve({ exitCode: 0, cwd: null, stopped: null })),
   },
   beforeEach: () => {
      window.localStorage.removeItem('berry:preview-terminal');
   },
} satisfies Meta<typeof PreviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A build's type error, read out of the real log and listed as a Problem. */
export const Problems: Story = {
   args: { running: false, status: 'failed · commit a1b2c3d · web …' },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('tab', { name: /Problems/ }));
      const panel = within(canvasElement);
      await expect(
         await panel.findByText("Property 'count' does not exist on type 'Props'.")
      ).toBeVisible();
   },
};

/** The app is up: the Terminal tab opens on its session, and a new shell can be started in its container. */
export const Terminal: Story = {
   play: async ({ canvas, canvasElement }) => {
      const panel = within(canvasElement);
      await expect(
         await panel.findByRole('tab', { name: 'Terminal', selected: true })
      ).toBeVisible();
      await expect(canvas.getByText('> next dev')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'New terminal session' })).toBeEnabled();
   },
};

/** The Environment tab is a task's build variables, loaded and edited through `PreviewEnv`. */
export const EnvironmentTab: Story = {
   beforeEach: ({ msw }) => {
      window.localStorage.removeItem('berry:preview-terminal');
      const file: PreviewEnvFile = {
         available: true,
         project: { id: 'proj-health', name: 'Persist project health' },
         text: 'DATABASE_URL=postgres://localhost/berry',
         updatedAt: '2026-09-17T14:00:00Z',
      };
      msw.use(
         http.get('*/api/v1/issues/BERR-1/preview-environment/env', () => HttpResponse.json(file))
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('tab', { name: 'Environment' }));
      const panel = within(canvasElement);
      await expect(await panel.findByText('Encrypted')).toBeVisible();
   },
};
